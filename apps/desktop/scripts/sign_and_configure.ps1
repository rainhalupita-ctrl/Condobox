# Script de Assinatura Digital e Configuracao de Permissoes do CondoBox
Write-Host "[CondoBox Security] Verificando Certificado Digital de Code Signing..." -ForegroundColor Cyan

$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*CondoBox*" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "Gerando Certificado Digital oficial para CondoBox Tecnologia..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=CondoBox Tecnologia Condominial, O=CondoBox, C=BR" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(10)
    
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
    $store.Open("ReadWrite")
    $store.Add($cert)
    $store.Close()
}

Write-Host "Certificado Ativo: $($cert.Subject)" -ForegroundColor Green

$exeFiles = Get-ChildItem "release" -Recurse -Include *.exe -ErrorAction SilentlyContinue

foreach ($file in $exeFiles) {
    Unblock-File -Path $file.FullName
    Set-AuthenticodeSignature -Certificate $cert -FilePath $file.FullName | Out-Null
    $sig = Get-AuthenticodeSignature $file.FullName
    Write-Host "Binario Assinado: $($file.Name) [Status: $($sig.Status)]" -ForegroundColor Green
}

Write-Host "Todos os executaveis foram assinados e desbloqueados para o Windows com sucesso!" -ForegroundColor Cyan
