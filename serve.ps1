# Minimal static file server for local development.
# Needs nothing installed - uses the .NET HttpListener built into Windows.
#
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 3000
#
# Also accepts PUT on the files listed in $Writable, so the control panel can
# save module edits back to disk. Everything else is read-only.
#
# Stop it with Ctrl+C.

param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path

# The only paths a PUT may touch. Anything else gets a 403, so a stray request
# cannot overwrite the page or the design system.
$Writable = @('modules.json')

# Resolved up front, and compared against the resolved request path rather than
# the raw one: './modules.json' and 'a/../modules.json' name the same file and
# must get the same answer.
$WritableFull = $Writable | ForEach-Object {
  [System.IO.Path]::GetFullPath((Join-Path $Root $_))
}

# Containment is checked against the root *plus a separator*. Without it this is
# a bare string-prefix test, and a sibling directory whose name merely starts
# the same way — "...\Rotating Mainframe Core-backup" — would satisfy it.
$RootPrefix = $Root.TrimEnd('\') + '\'

# The groups a version 2 module may carry. Only their presence and type are
# checked here; what belongs inside them is the schema's business.
$ModuleGroups = @('geometry', 'motion', 'appearance', 'layout', 'meta', 'links', 'telemetry')

# Is this a real, finite number? null, '' and $true all survive a careless
# numeric cast and none of them are a radius, so the type is checked before
# parsing. Strings are parsed as invariant, or a comma-decimal locale would
# reject "0.62".
function Test-Number($v, [ref]$out) {
  if ($v -is [double] -or $v -is [int] -or $v -is [long] -or $v -is [decimal]) {
    $out.Value = [double]$v
  } elseif ($v -is [string] -and -not [string]::IsNullOrWhiteSpace($v)) {
    $d = 0.0
    $ok = [double]::TryParse(
      $v,
      [System.Globalization.NumberStyles]::Float,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [ref]$d)
    if (-not $ok) { return $false }
    $out.Value = $d
  } else {
    return $false
  }
  return -not ([double]::IsNaN($out.Value) -or [double]::IsInfinity($out.Value))
}

# Why the body is inspected at all: this server is the last thing standing
# between a stray request and a modules.json the page cannot start from. Valid
# JSON is not the same as a valid module list, and it is the module list the
# page needs.
#
# Deliberately only as deep as "the page will start": identity, a status, the
# handful of numbers the scene cannot be built without, and well-formed groups.
# The full schema — ranges, colour formats, tag types — lives in
# modules-store.js and is enforced in the browser before the write is even
# attempted. Restating it here would only give it somewhere to drift.
#
# Returns an error string, or $null if the document is usable.
function Get-ModuleDocError($doc) {
  if ($null -eq $doc) { return 'body is empty' }
  if ($doc -is [string] -or $doc -is [System.ValueType]) { return 'body is a scalar, not a module document' }

  if ($doc -is [System.Collections.IEnumerable]) {
    $list = @($doc)                       # a bare array is accepted, as on read
  } elseif ($doc.PSObject.Properties.Name -contains 'modules') {
    $list = @($doc.modules)
  } elseif (($doc.PSObject.Properties.Name -contains 'id') -or ($doc.PSObject.Properties.Name -contains 'name')) {
    # ConvertFrom-Json unwraps a one-element top-level array into the element
    # itself, so a single-module bare array arrives looking like one object.
    $list = @($doc)
  } else {
    return 'no "modules" array'
  }
  if ($list.Count -eq 0) { return 'module list is empty' }

  $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
  $d = 0.0

  for ($i = 0; $i -lt $list.Count; $i++) {
    $m = $list[$i]
    if ($null -eq $m -or $m -is [System.ValueType] -or $m -is [string]) { return "entry $i is not an object" }
    $props = $m.PSObject.Properties.Name

    # Version 1 entries are flat and keyed by name; version 2 nests and keys by
    # id. Both are accepted, because both are things the page can read.
    $isV1 = ($props -notcontains 'id') -and ($props -contains 'name')

    if ($isV1) {
      $who = [string]$m.name
      if ([string]::IsNullOrWhiteSpace($who)) { return "entry $i has no name" }
      if (-not $ids.Add($who)) { return "duplicate name '$who'" }
      if ($props -notcontains 'status' -or [string]::IsNullOrWhiteSpace([string]$m.status)) { return "${who}: no status" }
      foreach ($f in @('radius', 'y', 'arc', 'speed', 'band')) {
        if ($props -notcontains $f) { return "${who}: missing $f" }
        if (-not (Test-Number $m.$f ([ref]$d))) { return "${who}: $f is not a number" }
      }
      continue
    }

    $who = [string]$m.id
    if ($props -notcontains 'id' -or [string]::IsNullOrWhiteSpace($who)) { return "entry $i has no id" }
    if (-not $ids.Add($who)) { return "duplicate id '$who'" }
    if ($props -notcontains 'status' -or [string]::IsNullOrWhiteSpace([string]$m.status)) { return "${who}: no status" }

    # A group that is present has to be an object, or the reader cannot index it.
    foreach ($g in $ModuleGroups) {
      if ($props -notcontains $g) { continue }
      $gv = $m.$g
      if ($null -eq $gv -or $gv -is [System.ValueType] -or $gv -is [string] -or $gv -is [System.Collections.IEnumerable]) {
        return "${who}: $g must be an object"
      }
    }

    if ($props -notcontains 'geometry') { return "${who}: missing geometry" }
    $geo = $m.geometry
    foreach ($f in @('radius', 'y', 'arc', 'band')) {
      if ($geo.PSObject.Properties.Name -notcontains $f) { return "${who}: missing geometry.$f" }
      if (-not (Test-Number $geo.$f ([ref]$d))) { return "${who}: geometry.$f is not a number" }
    }

    if ($props -notcontains 'motion') { return "${who}: missing motion" }
    if ($m.motion.PSObject.Properties.Name -notcontains 'speed') { return "${who}: missing motion.speed" }
    if (-not (Test-Number $m.motion.speed ([ref]$d))) { return "${who}: motion.speed is not a number" }
  }
  return $null
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.otf'  = 'font/otf'
  '.ttf'  = 'font/ttf'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.obj'  = 'text/plain; charset=utf-8'
  '.mtl'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "Could not bind port $Port. Try another: .\serve.ps1 -Port 8081" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  Serving $Root" -ForegroundColor Gray
Write-Host "  http://localhost:$Port/digital-system-core.html" -ForegroundColor Cyan
Write-Host "  Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response

  # Decode %20 etc, drop any query string, normalise separators.
  $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
  if ($rel -eq '') { $rel = 'digital-system-core.html' }
  $rel = $rel -replace '/', '\'

  $path = Join-Path $Root $rel
  $full = [System.IO.Path]::GetFullPath($path)

  # Refuse anything that escapes the served root.
  if (-not $full.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    $res.StatusCode = 403
    $res.Close()
    Write-Host "403 $rel" -ForegroundColor Red
    continue
  }

  if ($req.HttpMethod -eq 'PUT') {
    $reply = $null
    $code = 200

    if ($WritableFull -notcontains $full) {
      $code = 403
      $reply = 'not writable'
    } else {
      $tmp = "$full.tmp"
      try {
        # JSON is UTF-8 by definition, and HttpListener falls back to a
        # non-UTF-8 default when the Content-Type carries no charset - which is
        # what the store sends. Decoding by that default would mangle any
        # non-ASCII module name on the way in.
        $reader = New-Object System.IO.StreamReader($req.InputStream, (New-Object System.Text.UTF8Encoding($false)))
        $payload = $reader.ReadToEnd()
        $reader.Close()

        # Parse before writing: a malformed body must not land on disk and
        # leave the page unable to start next time.
        $doc = ConvertFrom-Json $payload

        # ...and parsing is not enough on its own. '{"hello":"world"}' is
        # perfectly good JSON that the page cannot start from, so the shape is
        # checked too, before anything is written.
        $shapeError = Get-ModuleDocError $doc
        if ($shapeError) { throw $shapeError }

        # Write beside the target, then swap it in. Replace exchanges directory
        # entries, so a reader sees either the old file or the new one and an
        # interrupted save cannot leave a truncated modules.json - which is what
        # a plain copy over the original risks, since it truncates as it opens.
        # UTF8 without BOM: a BOM would break JSON.parse.
        [System.IO.File]::WriteAllText($tmp, $payload, (New-Object System.Text.UTF8Encoding($false)))
        if ([System.IO.File]::Exists($full)) {
          # [NullString]::Value, not $null: PowerShell binds a bare $null to a
          # string parameter as '', and Replace rejects that as a backup path.
          [System.IO.File]::Replace($tmp, $full, [NullString]::Value)   # consumes $tmp
        } else {
          [System.IO.File]::Move($tmp, $full)
        }

        $reply = 'saved'
      } catch {
        $code = 400
        $reply = $_.Exception.Message
      } finally {
        # A failure between writing and swapping would otherwise leave litter in
        # the served directory.
        if (Test-Path -LiteralPath $tmp) {
          try { [System.IO.File]::Delete($tmp) } catch {}
        }
      }
    }

    # Flatten quotes and newlines - the message goes inside a JSON string.
    $reply = ($reply -replace '["\r\n\t]', ' ').Trim()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("{""ok"": $(($code -eq 200).ToString().ToLower()), ""message"": ""$reply""}")
    $res.StatusCode = $code
    $res.ContentType = 'application/json; charset=utf-8'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()

    $colour = if ($code -eq 200) { 'Green' } else { 'Red' }
    Write-Host "$code $($req.HttpMethod) $rel - $reply" -ForegroundColor $colour
    continue
  }

  # Anything that is not a read and not the PUT handled above. Saying so beats
  # falling through to the file server, which would answer a POST with the file
  # and look like the write had succeeded.
  if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') {
    $res.StatusCode = 405
    $res.Headers.Add('Allow', 'GET, HEAD, PUT')
    $res.Close()
    Write-Host "405 $($req.HttpMethod) $rel" -ForegroundColor Yellow
    continue
  }

  if (Test-Path -LiteralPath $full -PathType Container) {
    $index = Join-Path $full 'index.html'
    if (Test-Path -LiteralPath $index) { $full = $index }
  }

  if (Test-Path -LiteralPath $full -PathType Leaf) {
    try {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $res.ContentType = $type
      # Always revalidate - you are editing these files while the page is open.
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "200 $rel" -ForegroundColor DarkGray
    } catch {
      $res.StatusCode = 500
      Write-Host "500 $rel - $($_.Exception.Message)" -ForegroundColor Red
    }
  } else {
    $res.StatusCode = 404
    Write-Host "404 $rel" -ForegroundColor Yellow
  }

  $res.Close()
}
