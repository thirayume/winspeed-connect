[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$ServerIp,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$ServerHostname,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$')]
    [string]$AllowedCidr
)

$ErrorActionPreference = 'Stop'
$DeployRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $DeployRoot)
$SecretsDir = Join-Path $DeployRoot '.local-secrets'
$DeployKey = Join-Path $SecretsDir 'worldfert-hostinger-deploy'
$SftpKey = Join-Path $SecretsDir 'worldfert-hostinger-sftp'

foreach ($required in @($DeployKey, "$DeployKey.pub", $SftpKey, "$SftpKey.pub")) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing required SSH key: $required"
    }
}

function New-SafeSecret {
    param([int]$Length = 40)

    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.:@%+,-'
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes = New-Object byte[] ($Length * 2)
        $builder = [System.Text.StringBuilder]::new()
        while ($builder.Length -lt $Length) {
            $rng.GetBytes($bytes)
            foreach ($byte in $bytes) {
                if ($builder.Length -ge $Length) { break }
                [void]$builder.Append($alphabet[$byte % $alphabet.Length])
            }
        }
        return $builder.ToString()
    }
    finally {
        $rng.Dispose()
    }
}

function New-Password {
    param([int]$Length = 32)
    return 'Wf9@' + (New-SafeSecret -Length ($Length - 4))
}

$mssqlSaPassword = New-Password
$mysqlRootPassword = New-Password
$mysqlAppPassword = New-Password
$readerPassword = New-Password
$ownerPassword = New-Password
$jwtSecret = New-SafeSecret -Length 64
$migrateSecret = New-SafeSecret -Length 48
$ingestSecret = New-SafeSecret -Length 48
$appAdminPassword = New-Password

$appDomain = "app.$ServerHostname"
$apiDomain = "api.$ServerHostname"
$mssqlDomain = "mssql.$ServerHostname"
$mysqlDomain = "mysql.$ServerHostname"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$envPath = Join-Path $DeployRoot '.env'
$serverConfigPath = Join-Path $DeployRoot 'server\server-config.env'
$remoteConfigPath = Join-Path $DeployRoot 'windows\remote-config.bat'
$credentialsPath = Join-Path $SecretsDir 'CREDENTIALS.txt'
$downloadDir = Join-Path $SecretsDir 'downloads'
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

$envText = @"
APP_DOMAIN=$appDomain
API_DOMAIN=$apiDomain
ACME_EMAIL=
VITE_API_BASE_URL=https://$apiDomain/api
CORS_ORIGIN=https://$appDomain

DB_NAME=dbwins_worldfert9
MYSQL_DATABASE=db_truckscale
MSSQL_PID=Express
MSSQL_SA_PASSWORD=$mssqlSaPassword
MYSQL_ROOT_PASSWORD=$mysqlRootPassword
MYSQL_USER=wfapp
MYSQL_PASSWORD=$mysqlAppPassword
WF_READER_PASSWORD=$readerPassword
WF_OWNER_PASSWORD=$ownerPassword

JWT_SECRET=$jwtSecret
JWT_EXPIRES_IN=8h
MIGRATE_SECRET=$migrateSecret
TS_INGEST_SECRET=$ingestSecret
DEFAULT_SEED_PASSWORD=$appAdminPassword
TS_SYNC_INTERVAL_MS=60000
APP_VERSION=1.0.0

TZ=Asia/Bangkok
MSSQL_MEMORY_LIMIT_MB=4096
MSSQL_MEM_LIMIT=5G
MYSQL_BUFFER_POOL=768M
MYSQL_MEM_LIMIT=1500M

DB_BIND_IP=0.0.0.0
MSSQL_PUBLIC_PORT=1433
MYSQL_PUBLIC_PORT=3306
HTTP_PORT=80
HTTPS_PORT=443

TRANSFER_ROOT=/srv/wf-transfer
MSSQL_CERT_DIR=/opt/worldfert/secrets/mssql
MYSQL_CERT_DIR=/opt/worldfert/secrets/mysql
MSSQL_CONFIG_FILE=/opt/worldfert/secrets/mssql/mssql.conf

BACKUP_RETAIN_DAYS=35
BACKUP_MIN_FREE_GB=15

LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
LINE_LOGIN_CALLBACK_URL=
LINE_LOGIN_SUCCESS_REDIRECT=
TS_PRODUCTION_HOSTS=
"@

$serverConfigText = @"
DEPLOY_USER=root
SFTP_USER=wfbackup
SSH_PORT=22
APP_ROOT=/opt/worldfert
TRANSFER_ROOT=/srv/wf-transfer
SERVER_TIMEZONE=Asia/Bangkok

SERVER_PUBLIC_IP=$ServerIp
MSSQL_DOMAIN=$mssqlDomain
MYSQL_DOMAIN=$mysqlDomain

ADMIN_ALLOWED_CIDRS=$AllowedCidr
SFTP_ALLOWED_CIDRS=$AllowedCidr
DB_ALLOWED_CIDRS=$AllowedCidr
ALLOW_DATABASES_FROM_ANYWHERE=false
"@

$remoteConfigText = @"
@set "SERVER_HOST=$ServerIp"
@set "SSH_PORT=22"
@set "BOOTSTRAP_USER=root"
@set "DEPLOY_USER=root"
@set "SFTP_USER=wfbackup"
@set "APP_ROOT=/opt/worldfert"
@set "BOOTSTRAP_KEY=$DeployKey"
@set "DEPLOY_KEY=$DeployKey"
@set "SFTP_KEY=$SftpKey"
@set "DEPLOY_PUBLIC_KEY=$DeployKey.pub"
@set "SFTP_PUBLIC_KEY=$SftpKey.pub"
@set "DOWNLOAD_DIR=$downloadDir"
"@

$credentialsText = @"
CONFIDENTIAL - WorldFert Hostinger VPS credentials
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')

[VPS]
Plan=Hostinger KVM 2
OS=Ubuntu 24.04 LTS
Hostname=$ServerHostname
PublicIP=$ServerIp
SSHPort=22
RootUser=root
RootPassword=SET_BY_OWNER_NOT_STORED_HERE
RootSSHPrivateKey=$DeployKey

[DEPLOY]
User=root
Password=DISABLED_KEY_ONLY
PrivateKey=$DeployKey

[SFTP]
Host=$ServerIp
Port=22
User=wfbackup
Password=DISABLED_KEY_ONLY
PrivateKey=$SftpKey
UploadMSSQL=/incoming/mssql
UploadMySQL=/incoming/mysql
DownloadMSSQL=/outgoing/mssql
DownloadMySQL=/outgoing/mysql

[MSSQL]
Host=$mssqlDomain
Port=1433
Database=dbwins_worldfert9
AdminUser=sa
AdminPassword=$mssqlSaPassword
ReaderUser=wf_reader
ReaderPassword=$readerPassword
OwnerUser=wf_owner
OwnerPassword=$ownerPassword
Encrypt=true

[MYSQL]
Host=$mysqlDomain
Port=3306
Database=db_truckscale
RootUser=root
RootPassword=$mysqlRootPassword
AppUser=wfapp
AppPassword=$mysqlAppPassword
SslMode=VERIFY_CA

[APPLICATION]
Frontend=https://$appDomain
Backend=https://$apiDomain/api
InitialAdminUser=admin
InitialAdminPassword=$appAdminPassword
JwtSecret=$jwtSecret
MigrateSecret=$migrateSecret
TruckScaleIngestSecret=$ingestSecret

[NETWORK]
AllowedAdminSftpDatabaseCIDR=$AllowedCidr
HTTP=80/tcp public
HTTPS=443/tcp public
MSSQL=1433/tcp allowlist only
MySQL=3306/tcp allowlist only
"@

[System.IO.File]::WriteAllText($envPath, ($envText.Trim() + "`n"), $utf8NoBom)
[System.IO.File]::WriteAllText($serverConfigPath, ($serverConfigText.Trim() + "`n"), $utf8NoBom)
[System.IO.File]::WriteAllText($remoteConfigPath, ($remoteConfigText.Trim() + "`r`n"), [System.Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText($credentialsPath, ($credentialsText.Trim() + "`r`n"), $utf8NoBom)

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($secretFile in @($envPath, $serverConfigPath, $remoteConfigPath, $credentialsPath)) {
    & icacls.exe $secretFile /inheritance:r /grant:r "${identity}:(M)" 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null
}

Write-Host 'Hostinger deployment profile generated.'
Write-Host "Credentials: $credentialsPath"
Write-Host 'Secret values were not printed.'
