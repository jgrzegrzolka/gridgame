/**
 * Tiny blob client for reading + writing the catalog JSON files.
 * Uses the Function App's system-assigned managed identity (via
 * DefaultAzureCredential) — RBAC role `Storage Blob Data Contributor`
 * on the `styetanotherquiz` storage account is provisioned by the
 * Bicep template `infra/funcapp-release-daily.bicep`.
 */

import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();
const clients = new Map();

function svc(account) {
  let c = clients.get(account);
  if (!c) {
    c = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
    clients.set(account, c);
  }
  return c;
}

/**
 * @param {string} account
 * @param {string} container
 * @param {string} name
 * @returns {Promise<any>}
 */
export async function readJsonBlob(account, container, name) {
  const blob = svc(account).getContainerClient(container).getBlobClient(name);
  const resp = await blob.download();
  const body = await streamToString(resp.readableStreamBody);
  return JSON.parse(body);
}

/**
 * Upload `data` as JSON to the blob, overwriting any existing version.
 * Versioning is enabled on the storage account, so prior versions
 * remain queryable from the portal/CLI for rollback. Cache-Control of
 * 60s matches what the GitHub workflow set during Phase 1, so player
 * rollover at midnight stays predictable.
 *
 * @param {string} account
 * @param {string} container
 * @param {string} name
 * @param {unknown} data
 */
export async function writeJsonBlob(account, container, name, data) {
  const blob = svc(account).getContainerClient(container).getBlockBlobClient(name);
  const body = JSON.stringify(data, null, 2) + '\n';
  const bytes = Buffer.byteLength(body, 'utf8');
  await blob.upload(body, bytes, {
    blobHTTPHeaders: {
      blobContentType: 'application/json',
      blobCacheControl: 'max-age=60',
    },
  });
}

async function streamToString(stream) {
  if (!stream) throw new Error('blob: download had no readable stream');
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
