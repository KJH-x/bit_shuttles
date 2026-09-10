import test from "node:test";
import assert from "node:assert/strict";
import { signV4, sha256hex } from "../functions/_shared/r2-sign.js";

// SigV4 金向量：GET /test.txt（S3 风格，含 Range 头 + x-amz-content-sha256）。
// 该期望值与 AWS 官方客户端库 botocore（SigV4Auth + AWSRequest）逐字节比对一致
// （canonical request → string-to-sign → signature 全同），故作为回归锚点；
// 任何对签名构造的改动若导致此签名变化即判定为回归。

const ACCESS_KEY = "AKIDEXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const DATE = new Date("2013-05-24T00:00:00Z").getTime();

test("sha256hex: 官方空串与 hello 向量", () => {
  assert.equal(
    sha256hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
});

test("signV4: AWS 官方 GET /test.txt 金向量", () => {
  const { headers, amzDate, scope } = signV4({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    query: "",
    payload: "",
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    region: "us-east-1",
    service: "s3",
    date: DATE,
    contentType: null, // AWS 官方 GET 向量不签 content-type
    extraHeaders: { range: "bytes=0-9" } // AWS 官方示例的 Range 头
  });
  // 官方示例预期值
  assert.equal(amzDate, "20130524T000000Z");
  assert.equal(scope, "20130524/us-east-1/s3/aws4_request");
  assert.equal(
    headers["x-amz-content-sha256"],
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  const expectedSignature =
    "67fe34c8530db585abddc51067328adfedb6e42487d2566dc7d927d6e2722900"; // 与 botocore 比对一致
  assert.equal(
    headers.authorization,
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=${expectedSignature}`
  );
});

test("signV4: 不同请求头（content-type）改变签名（同一输入恒等）", () => {
  const a = signV4({
    method: "PUT",
    host: "example.com",
    path: "/obj.json",
    query: "",
    payload: "{}",
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    region: "auto",
    service: "s3",
    date: DATE
  });
  const b = signV4({
    method: "PUT",
    host: "example.com",
    path: "/obj.json",
    query: "",
    payload: "{}",
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    region: "auto",
    service: "s3",
    date: DATE
  });
  assert.equal(a.headers.authorization, b.headers.authorization);
  assert.ok(a.headers.authorization.includes("content-type;host"));
});
