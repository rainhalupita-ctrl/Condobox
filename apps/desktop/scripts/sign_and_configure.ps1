# Script de Assinatura Digital e Concessao de Permissoes do CondoBox
Write-Host "[CondoBox Security] Configurando Certificado Digital de Code Signing..." -ForegroundColor Cyan

$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*CondoBox*" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "Gerando Certificado Digital oficial para CondoBox Tecnologia..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=CondoBox Tecnologia Condominial, O=CondoBox, C=BR" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(10)
}

$pubStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
$pubStore.Open("ReadWrite")
$pubStore.Add($cert)
$pubStore.Close()

Write-Host "Certificado Ativo: $($cert.Subject)" -ForegroundColor Green

$exeFiles = Get-ChildItem "release" -Recurse -Include *.exe -ErrorAction SilentlyContinue

foreach ($file in $exeFiles) {
    Unblock-File -Path $file.FullName
    Set-AuthenticodeSignature -Certificate $cert -FilePath $file.FullName | Out-Null
    Write-Host "Executavel Assinado e Desbloqueado: $($file.Name)" -ForegroundColor Green
}

Write-Host "`nTodos os executaveis foram assinados e desbloqueados no Windows!" -ForegroundColor Cyan
