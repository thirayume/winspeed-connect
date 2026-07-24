<#
  Render the UAT DOCX candidate and write a machine-readable QA report.

  Preferred path: packaged documents skill renderer (LibreOffice + Poppler).
  Controlled fallback: Microsoft Word hidden/read-only PDF export + pypdfium2.
  The preferred process is hard-limited so a LibreOffice/profile hang cannot
  leave the documentation pipeline blocked indefinitely.
#>
param(
  [string]$DocxPath = '',
  [string]$OutputDir = '',
  [string]$PythonExe = '',
  [int]$PreferredTimeoutSeconds = 45,
  [switch]$ForceWordFallback
)
$ErrorActionPreference = 'Stop'
$HERE = $PSScriptRoot
$ENT = Split-Path (Split-Path $HERE -Parent) -Parent
if (-not $DocxPath) { $DocxPath = Join-Path $ENT '01-DOCX\candidate\UAT-Full-Loop-Run-Plan-v1.0.docx' }
if (-not $OutputDir) { $OutputDir = Join-Path $ENT ('01-DOCX\candidate\qa-render\' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
if (-not (Test-Path -LiteralPath $DocxPath)) { throw "DOCX not found: $DocxPath" }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

if (-not $PythonExe) {
  $bundled = 'C:\Users\amyou\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  if (Test-Path -LiteralPath $bundled) { $PythonExe = $bundled }
  else { $cmd = Get-Command python -ErrorAction SilentlyContinue; if ($cmd) { $PythonExe = $cmd.Source } }
}
if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe)) { throw 'Python runtime not found.' }

$renderDocx = 'C:\Users\amyou\.codex\plugins\cache\openai-primary-runtime\documents\26.715.12143\skills\documents\render_docx.py'
$renderPdf = Join-Path $HERE 'render_pdf_pages.py'
$sofficeDir = 'C:\Program Files\LibreOffice\program'
$popplerDir = 'C:\Users\amyou\AppData\Local\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin'
$preferredDir = Join-Path $OutputDir 'libreoffice'
$fallbackDir = Join-Path $OutputDir 'word-pdfium'
$preferred = [ordered]@{ attempted = $false; status = 'not-run'; exitCode = $null; stdout = ''; stderr = '' }
$method = $null
$pdfPath = $null
$pageCount = 0

if (-not $ForceWordFallback -and (Test-Path -LiteralPath $renderDocx) -and (Test-Path -LiteralPath (Join-Path $sofficeDir 'soffice.exe')) -and (Test-Path -LiteralPath (Join-Path $popplerDir 'pdftoppm.exe'))) {
  New-Item -ItemType Directory -Path $preferredDir -Force | Out-Null
  $preferred.attempted = $true
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $PythonExe
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  [void]$psi.ArgumentList.Add($renderDocx)
  [void]$psi.ArgumentList.Add((Resolve-Path -LiteralPath $DocxPath).Path)
  [void]$psi.ArgumentList.Add('--output_dir')
  [void]$psi.ArgumentList.Add($preferredDir)
  [void]$psi.ArgumentList.Add('--emit_pdf')
  $psi.Environment['PATH'] = $sofficeDir + ';' + $popplerDir + ';' + $env:PATH
  $proc = [Diagnostics.Process]::new()
  $proc.StartInfo = $psi
  [void]$proc.Start()
  if (-not $proc.WaitForExit($PreferredTimeoutSeconds * 1000)) {
    try { $proc.Kill($true) } catch {}
    $preferred.status = 'timeout'
  } else {
    $preferred.exitCode = $proc.ExitCode
    $preferred.stdout = $proc.StandardOutput.ReadToEnd()
    $preferred.stderr = $proc.StandardError.ReadToEnd()
    $pngs = @(Get-ChildItem -LiteralPath $preferredDir -Filter 'page-*.png' -File -ErrorAction SilentlyContinue)
    if ($proc.ExitCode -eq 0 -and $pngs.Count -gt 0) {
      $preferred.status = 'passed'
      $method = 'libreoffice-poppler'
      $pageCount = $pngs.Count
      $pdfItem = Get-ChildItem -LiteralPath $preferredDir -Filter '*.pdf' -File -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($pdfItem) { $pdfPath = $pdfItem.FullName }
    } else { $preferred.status = 'failed' }
  }
}

if (-not $method) {
  New-Item -ItemType Directory -Path $fallbackDir -Force | Out-Null
  $pdfPath = Join-Path $fallbackDir (([IO.Path]::GetFileNameWithoutExtension($DocxPath)) + '.pdf')
  $word = $null
  $doc = $null
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open((Resolve-Path -LiteralPath $DocxPath).Path, $false, $true)
    $doc.ExportAsFixedFormat($pdfPath, 17)
  } finally {
    if ($doc) { $doc.Close($false) }
    if ($word) { $word.Quit() }
    if ($doc) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc) }
    if ($word) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  }
  & $PythonExe $renderPdf $pdfPath $fallbackDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Word PDF export succeeded but PDFium page rendering failed.' }
  $pageCount = @(Get-ChildItem -LiteralPath $fallbackDir -Filter 'page-*.png' -File).Count
  if ($pageCount -lt 1) { throw 'Fallback render produced no page PNGs.' }
  $method = 'microsoft-word-pdfium'
}

$result = [ordered]@{
  status = 'PASSED'
  method = $method
  document = (Resolve-Path -LiteralPath $DocxPath).Path
  outputDir = (Resolve-Path -LiteralPath $OutputDir).Path
  pdf = $pdfPath
  pages = $pageCount
  preferredRenderer = $preferred
  generatedAt = (Get-Date).ToString('o')
}
$reportPath = Join-Path $OutputDir 'render-report.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$result | ConvertTo-Json -Depth 6

