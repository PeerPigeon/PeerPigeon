#!/usr/bin/env node
import os from 'node:os'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import multicastDns from 'multicast-dns'

const DEV_PORT_DEFAULT = 5173
const PUBLIC_HTTP_PORT = 80
const DEV_HOSTNAME = 'peer.local'
const MDNS_SERVICE_NAME = 'PeerPigeon Dev'

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

async function main() {
  const vitePort = await findAvailablePort(DEV_PORT_DEFAULT)
  const devProc = spawnLogged('npm', ['run', 'dev:raw', '--', '--port', String(vitePort)])

  let httpBridgeServer = null
  let publicPort = vitePort

  try {
    httpBridgeServer = createHttpBridge(vitePort)
    await new Promise((resolve, reject) => {
      httpBridgeServer.on('error', reject)
      httpBridgeServer.listen(PUBLIC_HTTP_PORT, '0.0.0.0', () => resolve())
    })
    publicPort = PUBLIC_HTTP_PORT
    console.log(`[bridge] Public HTTP bridge listening on port ${PUBLIC_HTTP_PORT} -> Vite ${vitePort}`)
  } catch (error) {
    console.warn(`[bridge] Could not bind public port ${PUBLIC_HTTP_PORT} (${error.code || error.message}).`)
    console.warn(`[bridge] Access requires explicit port: http://${DEV_HOSTNAME}:${vitePort}`)
  }

  let mdnsProc = null
  let mdnsHostResponder = null
  if (process.platform === 'darwin') {
    const preferred = getPreferredIPv4()
    if (!preferred) {
      console.warn(`[mdns] Could not find a non-loopback IPv4 address. Skipping ${DEV_HOSTNAME}.`)
    } else {
      const { ip, interfaceName } = preferred
      try {
        mdnsHostResponder = startMdnsHostResponder(DEV_HOSTNAME, ip)
        console.log(`[mdns] Hostname responder active for ${DEV_HOSTNAME} -> ${ip}`)
      } catch (error) {
        console.warn(`[mdns] Could not start hostname responder (${error.message || error}).`)
      }

      mdnsProc = spawnLogged('dns-sd', [
        '-P',
        MDNS_SERVICE_NAME,
        '_http._tcp',
        'local',
        String(publicPort),
        `${DEV_HOSTNAME}.`,
        ip,
        'path=/'
      ])
      console.log(`[mdns] Advertising ${DEV_HOSTNAME} -> ${ip} on port ${publicPort} via ${interfaceName}`)
      if (isLinkLocalIPv4(ip)) {
        console.warn('[mdns] Using link-local address (169.254.x.x). LAN peers may not reach this host.')
      }
    }
  } else {
    console.log('[mdns] Non-macOS platform detected; skipping dns-sd mDNS host publication.')
  }

  function shutdown(code = 0) {
    if (mdnsProc && !mdnsProc.killed) {
      mdnsProc.kill('SIGTERM')
    }
    if (mdnsHostResponder) {
      mdnsHostResponder.close()
    }
    if (httpBridgeServer) {
      httpBridgeServer.close()
    }
    terminateProcessTree(devProc)
    process.exit(code)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  devProc.on('exit', (code, signal) => {
    if (mdnsProc && !mdnsProc.killed) {
      mdnsProc.kill('SIGTERM')
    }
    if (mdnsHostResponder) {
      mdnsHostResponder.close()
    }
    if (httpBridgeServer) {
      httpBridgeServer.close()
    }

    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })

  if (mdnsProc) {
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
