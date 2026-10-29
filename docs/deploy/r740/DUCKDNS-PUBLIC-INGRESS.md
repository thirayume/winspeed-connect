# R740 public PROD and UAT

Owner-approved deployment configuration, 29 October 2026. Deployment and certificate
issuance are verified separately in the deploy receipt; this file defines the topology.

| URL | SQL target | Internal API/web route |
|---|---|---|
| `https://worldfert.duckdns.org` | `dbwins_worldfert9` | unique Production backend/frontend aliases |
| `https://wfuat.duckdns.org` | `dbwins_worldfert9_uat` | unique UAT backend/frontend aliases |
| `https://172.16.30.169` | Production | existing internal CA, IP SAN |
| `https://172.16.30.169:8444` | UAT | independent UAT Caddy/internal CA |

Both public A records resolve to `118.172.229.224`. No AAAA record was observed in
the IPv4 DNS check. If an IPv6 record is added, its route must reach this same ingress.
If the ISP changes the WAN address, update both records using a separately configured
DDNS updater; never store a DuckDNS account token in Git, browser URLs or deploy logs.
HTTP-01/TLS-ALPN certificate validation does not require a DuckDNS API token.

## Router, Windows and Docker

1. UniFi WAN TCP **80 -> 172.16.30.169:80** and **443 -> 172.16.30.169:443**.
   Do not forward public 443 straight to UAT 8444: this bypasses the shared host router.
2. Windows IP Helper portproxy keeps those LAN ports forwarding to the same localhost
   ports, where WSL publishes the Production Caddy. Keep the existing IP Helper service.
3. Inspect/apply `host/Set-PublicWebIngress.ps1 -Apply` on R740 as administrator.
   This opens only TCP 80/443 on this server IP. Keep SQL, RDP and Docker private.
4. Deploy the reviewed commit to UAT first, then promote that exact SHA to main and
   run the guarded Production plan/apply with a fresh verified pre-deploy backup.
5. Production's `compose.edge-prod.yml` builds `Caddyfile.r740-edge`. Only its Caddy
   joins both app networks. Backend/migrator containers stay in their own network.
   Distinct aliases prevent Docker's generic `backend` name from selecting the wrong stack.

Port 8443 belongs to an unrelated existing Caddy and is not reused or stopped.
There is no need for an HTTPS-to-HTTPS proxy or `tls_insecure_skip_verify` here:
TLS terminates at the edge and HTTP travels only within the private Docker networks.
API, Socket.IO and uploads go directly from Caddy to the correct backend, retaining
one trusted proxy hop and client-IP rate limiting. Static SPA files go to its frontend.
Both browser origins are pinned in their own target CORS list; `/api` remains relative.

## Certificate and browser acceptance

Public sites use Caddy automatic ACME HTTPS on standard ports, with certificate/key
state persisted in the Production `caddy-data` volume. The IP site retains the existing
internal CA, copied volume-to-volume on R740 only. Never export any private key.
Do not delete the data volume on redeploy; Caddy renews managed certificates automatically.
Avoid repeated production ACME retries if validation fails: inspect DNS, WAN forwarding,
Windows firewall and Caddy issuance logs first. Test a new challenge design against a
staging CA in a separate test volume before requesting a trusted production certificate.

Verify from an external connection as well as LAN/VPN:

- HTTP redirects each public name to its own HTTPS URL, without 8444 or a private IP.
- Trusted HTTPS passes chain, SAN and expiry validation with the normal public trust store.
- `/` and every referenced JS/CSS asset return nonempty content with correct MIME types.
- `/api/health` returns HTTP 200/SQL up, and `/api/dbinfo` names the correct database.
- Login, authenticated APIs, cookies, Socket.IO, uploads and exports use the same origin.
- Existing UAT IP URL, SSRS on 8888 and the unrelated Caddy remain available.

LAN clients may use UniFi hairpin NAT, or split DNS resolving both public names directly
to `172.16.30.169`. Keep the browser URL as the hostname so SNI and certificate SAN match.
Using the bare public IP is not the public hostname certificate test.

Rollback: restore the previous reviewed app release and its ingress configuration;
remove only the named firewall rule if public access must be withdrawn. Preserve volumes,
backups and receipts. A code rollback does not undo applied schema migrations or restore
database contents; follow the separate database recovery procedure.

Opening the technical Production stack does not enable the restricted AI/104/116/107
simulation writers or certify AR-report reconciliation, GL, print forms or physical shipment.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy multiple-app pattern](https://caddyserver.com/docs/caddyfile/patterns),
[UniFi port forwarding](https://help.ui.com/hc/en-us/articles/235723207-UniFi-Gateway-Port-Forwarding),
[UniFi hairpin NAT](https://help.ui.com/hc/en-us/articles/30202160464023-Hairpin-NAT-in-UniFi).
