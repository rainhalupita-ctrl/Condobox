!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "CondoBox Portaria"
OutFile "..\release\Desinstalar CondoBox Portaria.exe"
Caption "Assistente de Desinstalação - CondoBox Portaria"
Icon "..\assets\icon.ico"
RequestExecutionLevel user
Unicode true

; Interface Configuration
!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_ABORTWARNING

; Welcome Page (Aviso antes de desinstalar)
!define MUI_PAGE_HEADER_TEXT "Desinstalar o CondoBox Portaria"
!define MUI_PAGE_HEADER_SUBTEXT "Remover todos os componentes do sistema do seu computador."
!define MUI_WELCOMEPAGE_TITLE "Assistente de Desinstalação do CondoBox Portaria"
!define MUI_WELCOMEPAGE_TEXT "Este assistente irá remover completamente o CondoBox Portaria do seu computador.$\r$\n$\r$\nAntes de continuar, certifique-se de que o aplicativo não esteja em execução.$\r$\n$\r$\nClique em Avançar para iniciar a desinstalação."
!insertmacro MUI_PAGE_WELCOME

; Progress Page
!insertmacro MUI_PAGE_INSTFILES

; Finish Page
!define MUI_FINISHPAGE_TITLE "Desinstalação Concluída"
!define MUI_FINISHPAGE_TEXT "O CondoBox Portaria foi removido com sucesso do seu computador.$\r$\n$\r$\nObrigado por utilizar nossos serviços."
!insertmacro MUI_PAGE_FINISH

; Language
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Desinstalar"
    DetailPrint "Encerrando processos ativos do CondoBox..."
    nsExec::Exec 'taskkill /F /IM "CondoBox Portaria.exe" /T'
    Sleep 1000

    DetailPrint "Removendo atalhos da Área de Trabalho..."
    Delete "$DESKTOP\CondoBox Portaria.lnk"
    Delete "$DESKTOP\CondoBox 1.0.0.lnk"

    DetailPrint "Removendo atalhos do Menu Iniciar..."
    Delete "$SMPROGRAMS\CondoBox Portaria\CondoBox Portaria.lnk"
    Delete "$SMPROGRAMS\CondoBox Portaria\Desinstalar CondoBox Portaria.lnk"
    RMDir /r "$SMPROGRAMS\CondoBox Portaria"

    DetailPrint "Removendo arquivos do programa..."
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\CondoBox Portaria\Uninstall CondoBox Portaria.exe"
        ExecWait '"$LOCALAPPDATA\Programs\CondoBox Portaria\Uninstall CondoBox Portaria.exe" /S _?=$LOCALAPPDATA\Programs\CondoBox Portaria'
    ${EndIf}

    RMDir /r "$LOCALAPPDATA\Programs\CondoBox Portaria"
    RMDir /r "$LOCALAPPDATA\condobox-desktop-updater"

    DetailPrint "Limpando registros do Windows..."
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CondoBoxPortaria"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\condobox-desktop"
    DeleteRegKey HKCU "Software\com.condobox.desktop"

    DetailPrint "Desinstalação finalizada com sucesso!"
SectionEnd
