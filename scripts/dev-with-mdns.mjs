#!/usr/bin/env node
import os from 'node:os'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import multicastDns from 'multicast-dns'
import { generateRandomPair } from 'unsea'

const DEV_PORT_DEFAULT = 5174
const PUBLIC_HTTP_PORT = 5172
const PUBLIC_HTTPS_PORT = 5173
const DEV_HOSTNAME = 'peer.local'
const DEV_HOSTNAME_ALIASES = [DEV_HOSTNAME, 'peerpigeon.local']
const MDNS_SERVICE_NAME = 'PeerPigeon Dev'
const INSTANCE_PID_FILE = '/tmp/peerpigeon-dev-with-mdns.pid'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const TLS_CERT_DIR = process.env.PEERPIGEON_TLS_DIR || path.join(REPO_ROOT, '.peerpigeon-dev-tls')
const TLS_KEY_PATH = `${TLS_CERT_DIR}/peerpigeon-dev.key.pem`
const TLS_CERT_PATH = `${TLS_CERT_DIR}/peerpigeon-dev.cert.pem`
const GENERATE_TLS_ONLY = process.argv.includes('--generate-tls')

function isRfc1918IPv4(ip) {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  )
}

function isLinkLocalIPv4(ip) {
  return ip.startsWith('169.254.')
}

function getPreferredIPv4() {
  const nets = os.networkInterfaces()
  const preferredOrder = ['en0', 'en1', 'eth0', 'eth1', 'wlan0']
  const candidates = []

  for (const name of preferredOrder) {
    const addresses = nets[name] || []
    for (const entry of addresses) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue
      candidates.push({ interfaceName: name, ip: entry.address })
    }
  }

  for (const [name, entries] of Object.entries(nets)) {
    if (preferredOrder.includes(name)) continue
    for (const entry of entries || []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue
      candidates.push({ interfaceName: name, ip: entry.address })
    }
  }

  const lanCandidate = candidates.find(({ ip }) => isRfc1918IPv4(ip))
  if (lanCandidate) return lanCandidate

  const nonLinkLocal = candidates.find(({ ip }) => !isLinkLocalIPv4(ip))
  if (nonLinkLocal) return nonLinkLocal

  return candidates[0] ?? null
}

function spawnLogged(command, args, opts = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    detached: process.platform !== 'win32',
    ...opts
  })
}

function terminateProcessTree(child) {
  if (!child || child.killed || child.pid == null) return

  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM')
      return
    }

    // Kill the whole process group so npm, vite, and descendants do not linger.
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // Best-effort shutdown only.
    }
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function terminateProcessId(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      process.kill(pid, 'SIGTERM')
      return
    }
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // best-effort only
    }
  }
}

function readInstancePid() {
  try {
    const raw = fs.readFileSync(INSTANCE_PID_FILE, 'utf8').trim()
    const pid = Number.parseInt(raw, 10)
    if (!Number.isInteger(pid) || pid <= 0) return null
    return pid
  } catch {
    return null
  }
}

function writeInstancePid(pid) {
  try {
    fs.writeFileSync(INSTANCE_PID_FILE, String(pid), 'utf8')
  } catch {
    // best-effort only
  }
}

function clearInstancePid(pid) {
  const current = readInstancePid()
  if (current !== pid) return
  try {
    fs.unlinkSync(INSTANCE_PID_FILE)
  } catch {
    // best-effort only
  }
}

async function reclaimPreviousInstance() {
  const previousPid = readInstancePid()
  if (!previousPid || previousPid === process.pid) return
  if (!isProcessRunning(previousPid)) {
    clearInstancePid(previousPid)
    return
  }

  console.warn(`[dev] Found existing wrapper instance (pid ${previousPid}), shutting it down...`)
  terminateProcessId(previousPid)

  await new Promise((resolve) => setTimeout(resolve, 900))

  if (isProcessRunning(previousPid)) {
    console.warn(`[dev] Prior instance pid ${previousPid} is still alive; startup may need a manual stop.`)
  } else {
    clearInstancePid(previousPid)
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const probe = net.createServer()
      probe.unref()
      probe.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          tryPort(port + 1)
          return
        }
        reject(err)
      })
      probe.listen(port, '0.0.0.0', () => {
        const address = probe.address()
        probe.close(() => {
          if (address && typeof address === 'object') {
            resolve(address.port)
            return
          }
          reject(new Error('Could not determine available port'))
        })
      })
    }

    tryPort(startPort)
  })
}

function createHttpBridge(targetPort) {
  const server = http.createServer((req, res) => {
    const upstream = http.request(
      {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      }
    )

    upstream.on('error', (error) => {
      res.statusCode = 502
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.setHeader('cache-control', 'no-store, no-cache, must-revalidate')
      res.setHeader('pragma', 'no-cache')
      res.setHeader('expires', '0')
      res.setHeader('retry-after', '1')
      res.end(`Upstream connection failed: ${error.message}`)
    })

    req.pipe(upstream)
  })

  // Support Vite websocket upgrades (HMR) via raw TCP tunneling.
  server.on('upgrade', (req, clientSocket, head) => {
    // Browser/devtools may drop upgrade sockets abruptly during reload.
    // Swallow socket-level errors so these transient resets do not crash dev.
    clientSocket.on('error', () => {})

    const upstreamSocket = net.connect(targetPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) lines.push(`${key}: ${item}`)
        } else if (value !== undefined) {
          lines.push(`${key}: ${value}`)
        }
      }
      lines.push('', '')

      upstreamSocket.write(lines.join('\r\n'))
      if (head && head.length) upstreamSocket.write(head)
      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })

    upstreamSocket.on('error', () => {
      clientSocket.destroy()
    })

    clientSocket.on('close', () => {
      upstreamSocket.destroy()
    })

    upstreamSocket.on('close', () => {
      clientSocket.destroy()
    })
  })

  return server
}

function createHttpsBridge(targetPort, tlsOptions) {
  const server = https.createServer(tlsOptions, (req, res) => {
    const upstream = http.request(
      {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      }
    )

    upstream.on('error', (error) => {
      res.statusCode = 502
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.setHeader('cache-control', 'no-store, no-cache, must-revalidate')
      res.setHeader('pragma', 'no-cache')
      res.setHeader('expires', '0')
      res.setHeader('retry-after', '1')
      res.end(`Upstream connection failed: ${error.message}`)
    })

    req.pipe(upstream)
  })

  // Tunnel websocket upgrades to Vite for HMR over TLS endpoint.
  server.on('upgrade', (req, clientSocket, head) => {
    clientSocket.on('error', () => {})

    const upstreamSocket = net.connect(targetPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) lines.push(`${key}: ${item}`)
        } else if (value !== undefined) {
          lines.push(`${key}: ${value}`)
        }
      }
      lines.push('', '')

      upstreamSocket.write(lines.join('\r\n'))
      if (head && head.length) upstreamSocket.write(head)
      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })

    upstreamSocket.on('error', () => {
      clientSocket.destroy()
    })

    clientSocket.on('close', () => {
      upstreamSocket.destroy()
    })

    upstreamSocket.on('close', () => {
      clientSocket.destroy()
    })
  })

  return server
}

function createHttpRedirectServer(httpsPort) {
  const server = http.createServer((req, res) => {
    const rawHost = String(req.headers.host || DEV_HOSTNAME)
    const host = rawHost.split(':')[0] || DEV_HOSTNAME
    const portSegment = httpsPort === 443 ? '' : `:${httpsPort}`
    const location = `https://${host}${portSegment}${req.url || '/'}`
    res.writeHead(308, {
      location,
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0'
    })
    res.end('Redirecting to HTTPS')
  })

  server.on('upgrade', (req, socket) => {
    const rawHost = String(req.headers.host || DEV_HOSTNAME)
    const host = rawHost.split(':')[0] || DEV_HOSTNAME
    const portSegment = httpsPort === 443 ? '' : `:${httpsPort}`
    const location = `https://${host}${portSegment}${req.url || '/'}`
    socket.write(
      `HTTP/1.1 308 Permanent Redirect\r\n` +
      `Connection: close\r\n` +
      `Location: ${location}\r\n\r\n`
    )
    socket.destroy()
  })

  return server
}

async function ensureDevTlsCertificate(hostnames, ipAddress) {
  fs.mkdirSync(TLS_CERT_DIR, { recursive: true })

  const isExistingKeyValid = () => {
    try {
      if (!fs.existsSync(TLS_KEY_PATH)) return false
      const keyPem = fs.readFileSync(TLS_KEY_PATH)
      createPrivateKey(keyPem)
      return true
    } catch {
      return false
    }
  }

  if (!isExistingKeyValid()) {
    try {
      fs.unlinkSync(TLS_KEY_PATH)
    } catch {
      // best-effort only
    }
    try {
      fs.unlinkSync(TLS_CERT_PATH)
    } catch {
      // best-effort only
    }

    const keys = await generateRandomPair()
    const [x, y] = String(keys.pub || '').split('.')
    if (!x || !y || !keys.priv) {
      throw new Error('UNSEA key material shape is invalid for TLS key generation')
    }

    const privateJwk = {
      kty: 'EC',
      crv: 'P-256',
      d: keys.priv,
      x,
      y
    }
    const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' })
    const pemPrivateKey = privateKey.export({ format: 'pem', type: 'pkcs8' })
    fs.writeFileSync(TLS_KEY_PATH, pemPrivateKey, { mode: 0o600 })
  }

  if (!fs.existsSync(TLS_CERT_PATH)) {
    const uniqueHosts = Array.from(new Set((hostnames || []).filter(Boolean)))
    const sanEntries = [
      ...uniqueHosts.map((host) => `DNS:${host}`),
      'DNS:localhost',
      'IP:127.0.0.1'
    ]
    if (ipAddress) {
      sanEntries.push(`IP:${ipAddress}`)
    }

    const subjectHost = uniqueHosts[0] || 'localhost'
    let opensslResult = spawnSync('openssl', [
      'req',
      '-x509',
      '-new',
      '-sha256',
      '-days',
      '30',
      '-key',
      TLS_KEY_PATH,
      '-out',
      TLS_CERT_PATH,
      '-subj',
      `/CN=${subjectHost}`,
      '-addext',
      `subjectAltName=${sanEntries.join(',')}`
    ], {
      encoding: 'utf8'
    })

    // Older OpenSSL/LibreSSL builds may not support -addext. Retry with a config file.
    if (opensslResult.status !== 0) {
      const confPath = `${TLS_CERT_DIR}/openssl-san.cnf`
      const conf = [
        '[req]',
        'distinguished_name = req_distinguished_name',
        'x509_extensions = v3_req',
        'prompt = no',
        '',
        '[req_distinguished_name]',
        `CN = ${subjectHost}`,
        '',
        '[v3_req]',
        `subjectAltName = ${sanEntries.join(',')}`,
        'basicConstraints = CA:FALSE',
        'keyUsage = digitalSignature, keyEncipherment',
        'extendedKeyUsage = serverAuth'
      ].join('\n')
      fs.writeFileSync(confPath, conf, 'utf8')

      opensslResult = spawnSync('openssl', [
        'req',
        '-x509',
        '-new',
        '-sha256',
        '-days',
        '30',
        '-key',
        TLS_KEY_PATH,
        '-out',
        TLS_CERT_PATH,
        '-config',
        confPath,
        '-extensions',
        'v3_req'
      ], {
        encoding: 'utf8'
      })
    }

    if (opensslResult.status !== 0) {
      const stderr = String(opensslResult.stderr || '').trim()
      throw new Error(stderr || 'openssl certificate generation failed')
    }
  }

  return {
    key: fs.readFileSync(TLS_KEY_PATH),
    cert: fs.readFileSync(TLS_CERT_PATH)
  }
}

function startMdnsHostResponder(hostname, ip) {
  const fqdn = hostname.endsWith('.') ? hostname : `${hostname}.`
  const mdns = multicastDns()

  const answer = {
    name: fqdn,
    type: 'A',
    ttl: 120,
    data: ip,
  }

  const respond = () => {
    mdns.respond({ answers: [answer] })
  }

  const onQuery = (packet) => {
    const shouldAnswer = (packet.questions || []).some((question) => {
      const qName = (question.name || '').replace(/\.$/, '').toLowerCase()
      const hostName = fqdn.replace(/\.$/, '').toLowerCase()
      return qName === hostName && (question.type === 'A' || question.type === 'ANY')
    })

    if (shouldAnswer) respond()
  }

  mdns.on('query', onQuery)
  const intervalId = setInterval(respond, 30_000)
  intervalId.unref()
  respond()

  return {
    close: () => {
      clearInterval(intervalId)
      mdns.removeListener('query', onQuery)
      mdns.destroy()
    }
  }
}

function startMdnsHostResponders(hostnames, ip) {
  const uniqueHostnames = Array.from(new Set(hostnames.filter(Boolean)))
  const responders = uniqueHostnames.map((hostname) => startMdnsHostResponder(hostname, ip))
  return {
    close: () => {
      for (const responder of responders) {
        try {
          responder.close()
        } catch {
          // best-effort shutdown
        }
      }
    }
  }
}

async function main() {
  if (GENERATE_TLS_ONLY) {
    const preferredNetwork = process.platform === 'darwin' ? getPreferredIPv4() : null
    await ensureDevTlsCertificate(DEV_HOSTNAME_ALIASES, preferredNetwork?.ip)
    console.log(`[tls] Generated dev TLS key: ${TLS_KEY_PATH}`)
    console.log(`[tls] Generated dev TLS cert: ${TLS_CERT_PATH}`)
    return
  }

  await reclaimPreviousInstance()
  writeInstancePid(process.pid)

  const vitePort = await findAvailablePort(DEV_PORT_DEFAULT)
  const preferredNetwork = process.platform === 'darwin' ? getPreferredIPv4() : null
  let devProc = null
  let shutdownRequested = false
  let restartBackoffMs = 800
  let restartTimer = null

  let httpBridgeServer = null
  let httpsBridgeServer = null
  let tlsEnabled = false
  let publicPort = vitePort

  try {
    const tlsMaterial = await ensureDevTlsCertificate(DEV_HOSTNAME_ALIASES, preferredNetwork?.ip)
    httpsBridgeServer = createHttpsBridge(vitePort, tlsMaterial)
    await new Promise((resolve, reject) => {
      httpsBridgeServer.on('error', reject)
      httpsBridgeServer.listen(PUBLIC_HTTPS_PORT, '0.0.0.0', () => resolve())
    })
    tlsEnabled = true
    publicPort = PUBLIC_HTTPS_PORT
    console.log(`[tls] HTTPS bridge listening on port ${PUBLIC_HTTPS_PORT} -> Vite ${vitePort}`)
  } catch (error) {
    console.warn(`[tls] HTTPS bridge unavailable (${error.message || error}). Falling back to HTTP.`)
  }

  try {
    httpBridgeServer = tlsEnabled ? createHttpRedirectServer(PUBLIC_HTTPS_PORT) : createHttpBridge(vitePort)
    await new Promise((resolve, reject) => {
      httpBridgeServer.on('error', reject)
      httpBridgeServer.listen(PUBLIC_HTTP_PORT, '0.0.0.0', () => resolve())
    })
    if (tlsEnabled) {
      console.log(`[bridge] HTTP redirect listening on port ${PUBLIC_HTTP_PORT} -> HTTPS ${PUBLIC_HTTPS_PORT}`)
    } else {
      publicPort = PUBLIC_HTTP_PORT
      console.log(`[bridge] Public HTTP bridge listening on port ${PUBLIC_HTTP_PORT} -> Vite ${vitePort}`)
    }
  } catch (error) {
    console.warn(`[bridge] Could not bind public port ${PUBLIC_HTTP_PORT} (${error.code || error.message}).`)
    if (tlsEnabled) {
      console.warn(`[bridge] Access requires explicit HTTPS port: https://${DEV_HOSTNAME}:${PUBLIC_HTTPS_PORT}`)
    } else {
      console.warn(`[bridge] Access requires explicit port: http://${DEV_HOSTNAME}:${vitePort}`)
    }
  }

  const mdnsProcs = []
  let mdnsHostResponder = null
  if (process.platform === 'darwin') {
    const preferred = preferredNetwork
    if (!preferred) {
      console.warn(`[mdns] Could not find a non-loopback IPv4 address. Skipping ${DEV_HOSTNAME}.`)
    } else {
      const { ip, interfaceName } = preferred
      try {
        mdnsHostResponder = startMdnsHostResponders(DEV_HOSTNAME_ALIASES, ip)
        console.log(`[mdns] Hostname responders active for ${DEV_HOSTNAME_ALIASES.join(', ')} -> ${ip}`)
      } catch (error) {
        console.warn(`[mdns] Could not start hostname responder (${error.message || error}).`)
      }

      mdnsProcs.push(spawnLogged('dns-sd', [
        '-P',
        MDNS_SERVICE_NAME,
        tlsEnabled ? '_https._tcp' : '_http._tcp',
        'local',
        String(publicPort),
        `${DEV_HOSTNAME}.`,
        ip,
        'path=/'
      ]))
      console.log(`[mdns] Advertising ${DEV_HOSTNAME} -> ${ip} on port ${publicPort} via ${interfaceName}${tlsEnabled ? ' (HTTPS)' : ''}`)
      if (DEV_HOSTNAME_ALIASES.length > 1) {
        console.log(`[mdns] Alternate hostname available: ${DEV_HOSTNAME_ALIASES.slice(1).join(', ')}`)
      }
      if (isLinkLocalIPv4(ip)) {
        console.warn('[mdns] Using link-local address (169.254.x.x). LAN peers may not reach this host.')
      }
    }
  } else {
    console.log('[mdns] Non-macOS platform detected; skipping dns-sd mDNS host publication.')
  }

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  function scheduleRestart() {
    if (shutdownRequested) return
    if (restartTimer) return

    const delay = restartBackoffMs
    restartBackoffMs = Math.min(10_000, Math.floor(restartBackoffMs * 1.7))
    restartTimer = setTimeout(() => {
      restartTimer = null
      startDevProc()
    }, delay)
    restartTimer.unref?.()
    console.warn(`[dev] Vite exited. Restarting in ${delay}ms...`)
  }

  function startDevProc() {
    clearRestartTimer()
    devProc = spawnLogged('npm', ['run', 'dev:raw', '--', '--port', String(vitePort)])

    devProc.on('exit', (code, signal) => {
      devProc = null
      if (shutdownRequested) return
      if (signal) {
        console.warn(`[dev] Vite process terminated by signal ${signal}.`)
      } else {
        console.warn(`[dev] Vite process exited with code ${code ?? 'unknown'}.`)
      }
      scheduleRestart()
    })

    devProc.on('spawn', () => {
      restartBackoffMs = 800
      console.log(`[dev] Vite running on internal port ${vitePort}`)
    })
  }

  function shutdown(code = 0) {
    if (shutdownRequested) return
    shutdownRequested = true
    clearRestartTimer()

    const finalize = () => {
      for (const proc of mdnsProcs) {
        if (proc && !proc.killed) {
          proc.kill('SIGTERM')
        }
      }
      if (mdnsHostResponder) {
        mdnsHostResponder.close()
      }
      if (httpsBridgeServer) {
        httpsBridgeServer.close()
      }
      if (httpBridgeServer) {
        httpBridgeServer.close()
      }
      clearInstancePid(process.pid)
      process.exit(code)
    }

    if (devProc) {
      const current = devProc
      current.once('exit', () => finalize())
      terminateProcessTree(current)
      setTimeout(() => finalize(), 2000).unref?.()
    } else {
      finalize()
    }
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  startDevProc()

  for (const mdnsProc of mdnsProcs) {
    mdnsProc.on('exit', (code) => {
      if (code && code !== 0) {
        console.warn(`[mdns] dns-sd exited with code ${code}.`)
      }
    })
  }
}

main().catch((error) => {
  console.error(`[dev-with-mdns] Startup failed: ${error.stack || error.message}`)
  process.exit(1)
})
