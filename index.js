const express = require("express");
const { exec } = require("child_process");
const os = require("os");
const fs = require("fs");

const app = express();
const PORT = 3010;

const PANEL_USER = process.env.PANEL_USER || "admin";
const PANEL_PASS = process.env.PANEL_PASS || "change-this-panel-password-now";
const TUNNEL_MANAGER = "/usr/local/bin/tunnel-manager";

const DEPLOY_MAP = {
  app3000: "/root/apps/app3000/deploy.sh",
  dashboard: "/root/apps/dashboard/deploy.sh",
  "tunnel-ui": "/root/apps/tunnel-ui/deploy.sh",
  "control-panel": "/root/apps/control-panel/deploy.sh"
};

const QUICK_LINKS = [
  ["Home", "https://phoneserver.julkarnine.com"],
  ["App3000", "https://app3000.julkarnine.com"],
  ["Dashboard", "https://dashboard.julkarnine.com"],
  ["Tunnel UI", "https://tunnel.julkarnine.com"],
  ["Web Shell", "https://shell.julkarnine.com"],
  ["Uptime Kuma", "https://monitor.julkarnine.com"]
];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 30 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout || "",
        stderr: stderr || "",
        code: error && typeof error.code !== "undefined" ? error.code : 0
      });
    });
  });
}

function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Phone Control Panel"');
    return res.status(401).send("Authentication required");
  }

  const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = raw.indexOf(":");
  const user = idx >= 0 ? raw.slice(0, idx) : "";
  const pass = idx >= 0 ? raw.slice(idx + 1) : "";

  if (user !== PANEL_USER || pass !== PANEL_PASS) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Phone Control Panel"');
    return res.status(401).send("Invalid credentials");
  }

  next();
}

function page(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#0f172a;color:#e5e7eb;margin:0;padding:16px}
    .wrap{max-width:1280px;margin:0 auto}
    .card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:16px;margin-bottom:16px}
    h1,h2{margin-top:0}
    a{color:#7dd3fc}
    pre{white-space:pre-wrap;word-break:break-word;background:#020617;padding:12px;border-radius:12px;border:1px solid #1e293b;max-height:420px;overflow:auto}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th,td{text-align:left;padding:10px;border-bottom:1px solid #1f2937;vertical-align:top}
    input,select,button{background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:10px;font-size:14px}
    input,select{width:100%;box-sizing:border-box}
    button{cursor:pointer;background:#2563eb;border:none}
    .danger{background:#dc2626}
    .warn{background:#d97706}
    .ok{background:#059669}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
    .row{display:grid;grid-template-columns:1fr 120px auto;gap:10px;align-items:end}
    .row4{display:grid;grid-template-columns:1fr 120px 120px auto;gap:10px;align-items:end}
    .pill{display:inline-block;background:#1d4ed8;padding:4px 10px;border-radius:999px;margin-right:8px}
    .mini form{display:inline-block;margin-right:6px;margin-bottom:6px}
    @media (max-width: 900px){
      .grid2,.grid3,.row,.row4{grid-template-columns:1fr}
      table,thead,tbody,tr,td,th{display:block;width:100%}
      thead{display:none}
      tr{border-bottom:1px solid #1f2937;padding:10px 0}
      td{border:none;padding:6px 0}
      .mini form{display:block;margin:0 0 8px 0}
      button{width:100%}
    }
  </style>
</head>
<body>
  <div class="wrap">${body}</div>
</body>
</html>`;
}

app.use(auth);

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "control-panel", time: new Date().toISOString() });
});

app.get("/", async (req, res) => {
  const pm2Out = await run("pm2 jlist");
  const routesOut = await run(`${TUNNEL_MANAGER} list`);
  const tunnelOut = await run(`${TUNNEL_MANAGER} status`);
  const diskOut = await run("df -h / /root /data 2>/dev/null || true");
  const memOut = await run("free -h 2>/dev/null || true");
  const uptimeOut = await run("uptime 2>/dev/null || true");

  let pm2 = [];
  try { pm2 = JSON.parse(pm2Out.stdout || "[]"); } catch {}

  const appRows = pm2.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.pm2_env?.status || "")}</td>
      <td>${esc(String(p.monit?.cpu ?? 0))}%</td>
      <td>${Math.round((p.monit?.memory || 0) / 1024 / 1024)} MB</td>
      <td class="mini">
        <form method="post" action="/pm2/restart"><input type="hidden" name="name" value="${esc(p.name)}"><button type="submit">Restart</button></form>
        <form method="post" action="/pm2/stop"><input type="hidden" name="name" value="${esc(p.name)}"><button type="submit" class="warn">Stop</button></form>
        <form method="post" action="/pm2/start"><input type="hidden" name="name" value="${esc(p.name)}"><button type="submit" class="ok">Start</button></form>
        <form method="post" action="/pm2/logs"><input type="hidden" name="name" value="${esc(p.name)}"><button type="submit">Logs</button></form>
      </td>
    </tr>
  `).join("");

  const routeRows = (routesOut.stdout || "").split("\n").filter(x => x.includes("|")).map(line => {
    const [host, svc] = line.split("|");
    return `
      <tr>
        <td><strong>${esc(host)}</strong></td>
        <td>${esc(svc)}</td>
        <td class="mini">
          <form method="post" action="/route/test"><input type="hidden" name="host" value="${esc(host)}"><button type="submit">Test</button></form>
          <form method="post" action="/route/remove" onsubmit="return confirm('Remove ${esc(host)}?')"><input type="hidden" name="host" value="${esc(host)}"><button type="submit" class="danger">Remove</button></form>
        </td>
      </tr>
    `;
  }).join("");

  const deployOptions = Object.keys(DEPLOY_MAP).map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  const links = QUICK_LINKS.map(([name, url]) => `<p><a href="${url}" target="_blank">${esc(name)}</a></p>`).join("");

  res.send(page("Phone Control Panel v3.1", `
    <div class="card">
      <h1>Phone Control Panel v3.1</h1>
      <p><span class="pill">panel.julkarnine.com</span><a href="/health">Health</a></p>
    </div>

    <div class="grid3">
      <div class="card">
        <h2>System</h2>
        <p><strong>Hostname:</strong> ${esc(os.hostname())}</p>
        <p><strong>Platform:</strong> ${esc(os.platform() + " " + os.release())}</p>
        <p><strong>Node:</strong> ${esc(process.version)}</p>
        <pre>${esc(uptimeOut.stdout)}</pre>
      </div>
      <div class="card">
        <h2>Quick Links</h2>
        ${links}
      </div>
      <div class="card">
        <h2>Service Actions</h2>
        <form method="post" action="/service/nginx-reload" style="margin-bottom:10px"><button type="submit">Reload Nginx</button></form>
        <form method="post" action="/service/sshd-restart" style="margin-bottom:10px"><button type="submit">Restart SSHD</button></form>
        <form method="post" action="/tunnel/restart" style="margin-bottom:10px"><button type="submit">Restart Tunnel</button></form>
        <form method="post" action="/pm2/save"><button type="submit">PM2 Save</button></form>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>Add HTTP Route</h2>
        <form method="post" action="/route/add-http">
          <div class="row4">
            <div><label>Hostname</label><input name="host" placeholder="monitor.julkarnine.com" required></div>
            <div><label>Port</label><input name="port" placeholder="3002" required></div>
            <div><label>Type</label><input value="HTTP" disabled></div>
            <div><button type="submit">Add</button></div>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Add TCP Route</h2>
        <form method="post" action="/route/add-tcp">
          <div class="row4">
            <div><label>Hostname</label><input name="host" placeholder="ssh2.julkarnine.com" required></div>
            <div><label>Port</label><input name="port" placeholder="22" required></div>
            <div><label>Type</label><input value="TCP" disabled></div>
            <div><button type="submit">Add</button></div>
          </div>
        </form>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>Deploy App</h2>
        <form method="post" action="/deploy">
          <div class="row">
            <div><label>App</label><select name="app">${deployOptions}</select></div>
            <div><label>Action</label><input value="git pull + npm install + restart" disabled></div>
            <div><button type="submit">Deploy</button></div>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Health Checks</h2>
        <p><a href="https://phoneserver.julkarnine.com/health" target="_blank">phoneserver /health</a></p>
        <p><a href="https://app3000.julkarnine.com/health" target="_blank">app3000 /health</a></p>
        <p><a href="https://dashboard.julkarnine.com/health" target="_blank">dashboard /health</a></p>
        <p><a href="https://tunnel.julkarnine.com/health" target="_blank">tunnel-ui /health</a></p>
      </div>
    </div>

    <div class="card">
      <h2>PM2 Apps</h2>
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>CPU</th><th>Memory</th><th>Actions</th></tr></thead>
        <tbody>${appRows || '<tr><td colspan="5">No apps</td></tr>'}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Tunnel Routes</h2>
      <table>
        <thead><tr><th>Hostname</th><th>Service</th><th>Actions</th></tr></thead>
        <tbody>${routeRows || '<tr><td colspan="3">No routes</td></tr>'}</tbody>
      </table>
    </div>

    <div class="grid2">
      <div class="card"><h2>Disk</h2><pre>${esc(diskOut.stdout)}</pre></div>
      <div class="card"><h2>Memory</h2><pre>${esc(memOut.stdout)}</pre></div>
    </div>

    <div class="card">
      <h2>Tunnel Status</h2>
      <pre>${esc(tunnelOut.stdout || tunnelOut.stderr)}</pre>
    </div>
  `));
});

app.post("/pm2/restart", async (req, res) => { await run(`pm2 restart "${req.body.name}"`); await run(`pm2 save`); res.redirect("/"); });
app.post("/pm2/stop", async (req, res) => { await run(`pm2 stop "${req.body.name}"`); await run(`pm2 save`); res.redirect("/"); });
app.post("/pm2/start", async (req, res) => { await run(`pm2 start "${req.body.name}"`); await run(`pm2 save`); res.redirect("/"); });
app.post("/pm2/save", async (req, res) => { await run(`pm2 save`); res.redirect("/"); });

app.post("/pm2/logs", async (req, res) => {
  const out = await run(`pm2 logs "${req.body.name}" --lines 100 --nostream`);
  res.send(page("PM2 Logs", `<div class="card"><h1>Logs: ${esc(req.body.name)}</h1><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/route/add-http", async (req, res) => {
  const out = await run(`${TUNNEL_MANAGER} add-http ${req.body.host} ${req.body.port}`);
  res.send(page("Add HTTP Route", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/route/add-tcp", async (req, res) => {
  const out = await run(`${TUNNEL_MANAGER} add-tcp ${req.body.host} ${req.body.port}`);
  res.send(page("Add TCP Route", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/route/remove", async (req, res) => {
  const out = await run(`${TUNNEL_MANAGER} remove ${req.body.host}`);
  res.send(page("Remove Route", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/route/test", async (req, res) => {
  const out = await run(`${TUNNEL_MANAGER} test ${req.body.host}`);
  res.send(page("Test Route", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/tunnel/restart", async (req, res) => {
  const out = await run(`${TUNNEL_MANAGER} restart`);
  res.send(page("Tunnel Restart", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/service/nginx-reload", async (req, res) => {
  const out = await run(`nginx -t && /usr/sbin/nginx -s reload`);
  res.send(page("Reload Nginx", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/service/sshd-restart", async (req, res) => {
  const out = await run(`pkill sshd || true; mkdir -p /run/sshd; /usr/sbin/sshd; ss -ltnp | grep ':22 ' || true`);
  res.send(page("Restart SSHD", `<div class="card"><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.post("/deploy", async (req, res) => {
  const script = DEPLOY_MAP[req.body.app];
  if (!script || !fs.existsSync(script)) {
    return res.status(400).send(page("Deploy Error", `<div class="card"><pre>Unknown or missing deploy script</pre><p><a href="/">Back</a></p></div>`));
  }
  const out = await run(`bash ${script}`);
  res.send(page("Deploy Result", `<div class="card"><h1>Deploy ${esc(req.body.app)}</h1><pre>${esc(out.stdout + "\\n" + out.stderr)}</pre><p><a href="/">Back</a></p></div>`));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Control Panel v3.1 running on http://127.0.0.1:${PORT}`);
});
