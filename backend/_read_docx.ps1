Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('c:\MyWork\WorldFert\winspeed-frontend\refs\Meeting_Minutes_WorldFert_02072026.docx')
$entry = $zip.GetEntry('word/document.xml')
$stream = $entry.Open()
$reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
$xml = $reader.ReadToEnd()
$reader.Close()
$stream.Close()
$zip.Dispose()
$text = $xml -replace '<[^>]+>', ' '
$text = $text -replace '\s+', ' '
$text | Out-File -FilePath 'c:\MyWork\WorldFert\winspeed-frontend\backend\_minutes.txt' -Encoding UTF8
