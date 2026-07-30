import { AwsClient } from "aws4fetch";

export type DirectUploadTarget = {
  headers: Record<string, string>;
  method: "PUT";
  mode: "presigned-r2";
  url: string;
};

export async function createR2PresignedUpload(input: {
  byteSize: number;
  contentType: string;
  objectKey: string;
  sessionId: string;
}): Promise<DirectUploadTarget | null> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) return null;

  const headers = {
    "Content-Length": String(input.byteSize),
    "Content-Type": input.contentType,
    "x-amz-meta-benchmax-session": input.sessionId,
  };
  const objectUrl = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${encodeObjectKey(input.objectKey)}`,
  );
  objectUrl.searchParams.set("X-Amz-Expires", "600");

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const signed = await client.sign(
    new Request(objectUrl, { method: "PUT", headers }),
    {
      aws: {
        // aws4fetch excludes content-length/content-type unless allHeaders is
        // enabled. Both must be part of the signature so the bearer URL cannot
        // be reused for an object with different upload metadata.
        allHeaders: true,
        signQuery: true,
      },
    },
  );

  return { mode: "presigned-r2", method: "PUT", url: signed.url, headers };
}

function encodeObjectKey(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
