$content = Get-Content 'src\20-acs.js' -Raw -Encoding UTF8
$old = "      inicio: ['<i class=""fa-solid fa-play""></i> Procesar todo el rango', 'principal', 1, 1, 1, 0, 1],"
$new = "      inicio: [null, null, 0, 1, 1, 0, 1],"
# The file uses unicode escapes in the source, let's check what the actual bytes look like
# and do regex-based replacement
$result = $content -replace [regex]::Escape("inicio: ['\u003ci class=`"fa-solid fa-play`"\u003e\u003c/i\u003e Procesar todo el rango', 'principal', 1, 1, 1, 0, 1],"), "inicio: [null, null, 0, 1, 1, 0, 1],"
if ($result -eq $content) {
    Write-Host "NO MATCH - trying with literal escaped unicode chars"
    # Try with the actual unicode escape sequences as literal text
    $oldLit = "inicio: ['\u003ci class=`"fa-solid fa-play`"\u003e\u003c/i\u003e Procesar todo el rango', 'principal', 1, 1, 1, 0, 1],"
    $result = $content.Replace($oldLit, "inicio: [null, null, 0, 1, 1, 0, 1],")
    if ($result -eq $content) {
        Write-Host "NO MATCH EITHER"
    } else {
        [System.IO.File]::WriteAllText('src\20-acs.js', $result, [System.Text.Encoding]::UTF8)
        Write-Host "REPLACED OK"
    }
} else {
    [System.IO.File]::WriteAllText('src\20-acs.js', $result, [System.Text.Encoding]::UTF8)
    Write-Host "REPLACED OK"
}
