import chromium from "chrome-aws-lambda";
import { document } from "../utils/dynamodbClient";
import handlebars from "handlebars";
import path from "path";
import fs from "fs";
import dayjs from "dayjs";
import { S3 } from "aws-sdk";

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

const compile = async function (data: ITemplate) {
  const filePath = path.join(
    process.cwd(),
    "src",
    "templates",
    "certificate.hbs"
  );
  const html = fs.readFileSync(filePath, "utf-8");

  return handlebars.compile(html)(data);
};

export const handle = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

  const response = await document
    .query({
      TableName: "users_certificates",
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: {
        ":id": id,
      },
    })
    .promise();

  const userAlreadyExists = response.Items[0];

  if (!userAlreadyExists) {
    await document
      .put({
        TableName: "users_certificates",
        Item: {
          id,
          name,
          grade,
        },
      })
      .promise();
  }

  const medalPath = path.join(process.cwd(), "src", "templates", "selo.png");

  const medal = fs.readFileSync(medalPath, "base64");

  const data: ITemplate = {
    date: dayjs().format("DD/MM/YYYY"),
    grade,
    name,
    id,
    medal,
  };

  // Gerar certificado
  // Compilar usando handlebars
  const certificateContent = await compile(data);

  // Transformar em PDF
  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
  });

  const page = await browser.newPage();
  await page.setContent(certificateContent);
  const pdf = await page.pdf({
    format: "a4",
    landscape: true,
    path: process.env.IS_OFFLINE ? "certificate.pdf" : null,
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  // Salvar no S3
  const s3 = new S3();
  await s3
    .putObject({
      Bucket: "ignite-serverless-certificate",
      Key: `${id}.pdf`,
      ACL: "public-read",
      Body: pdf,
      ContentType: "application/pdf",
    })
    .promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: "Certificate created!",
      url: `https://ignite-serverless-certificate.s3.sa-east-1.amazonaws.com/${id}.pdf`,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  };
};
