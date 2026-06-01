param(
  [Parameter(Mandatory=$true)]
  [string[]]$Dirs,

  [Parameter(Mandatory=$true)]
  [string]$OutDir
)

# 출력 디렉토리 준비
$resolvedOut = (Resolve-Path -LiteralPath $OutDir -ErrorAction SilentlyContinue)
if (-not $resolvedOut) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  $resolvedOut = (Resolve-Path -LiteralPath $OutDir -ErrorAction SilentlyContinue)
}
if (-not $resolvedOut) { throw "OutDir resolve failed: $OutDir" }

foreach ($dir in $Dirs) {

  if (-not (Test-Path -LiteralPath $dir)) { continue }

  $resolved = (Resolve-Path -LiteralPath $dir -ErrorAction SilentlyContinue)
  if (-not $resolved) { continue }

  $name   = Split-Path $resolved.Path -Leaf

  # 파일명 충돌 방지(선택): 동일 leaf가 여러 번 들어오는 경우 대비
  $safeName = ($name -replace '[\\\/\:\*\?\"\<\>\|]', '_')
  $output   = Join-Path -Path $resolvedOut.Path -ChildPath ($safeName + ".txt")

  Get-ChildItem -LiteralPath $resolved.Path -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    ForEach-Object {
      "===== $($_.FullName) ====="
      try {
        Get-Content -LiteralPath $_.FullName -ErrorAction Stop
      } catch {
        "!! READ_ERROR: $($_.Exception.Message)"
      }
      ""
    } | Out-File -FilePath $output -Encoding UTF8
}