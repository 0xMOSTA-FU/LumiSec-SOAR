/**
 * Run wf-1 VirusTotal workflow test and print results.
 * Usage: node scripts/run-vt-test.mjs
 */
const base = process.env.SOAR_BASE_URL || 'http://localhost:3000';

async function main() {
  const wfRes = await fetch(`${base}/api/workflows`);
  const workflows = await wfRes.json();
  const wf1 = Array.isArray(workflows) ? workflows.find(w => w.id === 'wf-1') : null;
  console.log('Workflow wf-1:', wf1 ? `${wf1.name} (${wf1.status})` : 'NOT FOUND');

  const intRes = await fetch(`${base}/api/integrations`);
  const integrations = await intRes.json();
  const vt = Array.isArray(integrations)
    ? integrations.find(i => i.type === 'virustotal' || i.id === 'int-vt')
    : null;
  console.log('VirusTotal integration:', vt ? `status=${vt.status}, name=${vt.name}` : 'NOT FOUND');

  const body = {
    workflowId: 'wf-1',
    trigger: { ip: '8.8.8.8' },
    testRun: true,
  };

  console.log('\nStarting execution...');
  const execRes = await fetch(`${base}/api/workflow-executions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const execStart = await execRes.json();
  if (!execRes.ok) {
    console.error('Execute failed:', execRes.status, execStart);
    process.exit(1);
  }

  const execId = execStart.id || execStart.execution_id;
  console.log('Execution ID:', execId);

  let result = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const poll = await fetch(`${base}/api/workflow-executions/${execId}`);
    result = await poll.json();
    const status = result.status;
    console.log(`Poll ${i + 1}: status=${status}`);
    if (status === 'success' || status === 'failed' || status === 'error') break;
  }

  console.log('\n=== FINAL STATUS ===');
  console.log('status:', result?.status);
  console.log('success:', result?.status === 'success');

  let logs = [];
  try {
    logs = typeof result?.logs === 'string' ? JSON.parse(result.logs) : (result?.logs || []);
  } catch {
    logs = [];
  }

  console.log('\n=== LOGS ===');
  for (const log of logs) {
    const line = `[${log.level || 'info'}] ${log.nodeLabel || log.nodeId || ''}: ${log.message || ''}`;
    console.log(line);
    if (log.data) console.log('  data:', JSON.stringify(log.data).slice(0, 500));
  }

  let outputs = {};
  try {
    outputs = typeof result?.result === 'string' ? JSON.parse(result.result) : (result?.result || {});
  } catch {
    outputs = {};
  }

  const vtOut = Object.entries(outputs).find(([k]) => k.includes('n2') || JSON.stringify(outputs[k] || {}).includes('virustotal'));
  if (Object.keys(outputs).length) {
    console.log('\n=== OUTPUTS (sample) ===');
    console.log(JSON.stringify(outputs, null, 2).slice(0, 3000));
  }

  process.exit(result?.status === 'success' ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
