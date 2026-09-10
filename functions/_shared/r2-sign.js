// R2 / S3 SigV4 签名 + 对象读写（纯逻辑，可 node 单测；零外部依赖）。
// 唯一消费者：workspace/campus-shuttle-amap-refresh-20260905/amap-refresh.mjs
// （本地计划任务直写 R2 traffic/live.json；Pages Function 只读，不使用本模块）。
// 注意：签名正确性由 tests/r2sign.test.mjs 的 AWS 官方金向量锁定。

import { createHash, createHmac } from "node:crypto";

export function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function iso8601(ms) {
  return new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

// AWS SigV4 签名（S3 / R2 兼容）。返回 { headers, amzDate, scope }。
// contentType 传 null 可省略 content-type 头（如 GET 无 body；AWS 官方 GET 向量不签该头）。
// extraHeaders：额外请求头（如 Range），参与签名。
export function signV4({ method, host, path, query, payload, accessKey, secretKey, region, service, date, contentType = "application/json", extraHeaders = {} }) {
  const amzDate = iso8601(date);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(payload);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest)
  ].join("\n");
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...headers, authorization }, amzDate, scope };
}

// PUT 对象到 R2/S3（endpoint 如 https://<account>.r2.cloudflarestorage.com）
export async function putObject({ endpoint, bucket, key, body, accessKey, secretKey }) {
  const u = new URL(endpoint);
  const path = `/${bucket}/${key}`;
  const { headers } = signV4({
    method: "PUT",
    host: u.host,
    path,
    query: "",
    payload: body,
    accessKey,
    secretKey,
    region: "auto",
    service: "s3",
    date: Date.now()
  });
  const res = await fetch(`${endpoint}${path}`, { method: "PUT", headers, body });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status;
}

// GET 对象（读旧值用；不存在/失败返回 null）
export async function getObject({ endpoint, bucket, key, accessKey, secretKey }) {
  const u = new URL(endpoint);
  const path = `/${bucket}/${key}`;
  const { headers } = signV4({
    method: "GET",
    host: u.host,
    path,
    query: "",
    payload: "",
    accessKey,
    secretKey,
    region: "auto",
    service: "s3",
    date: Date.now(),
    contentType: "application/json" // 与原脚本 readOld 行为一致（GET 也签 content-type）
  });
  const res = await fetch(`${endpoint}${path}`, { method: "GET", headers });
  if (!res.ok) return null;
  return await res.json();
}
