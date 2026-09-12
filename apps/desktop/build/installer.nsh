!include nsDialogs.nsh
!include LogicLib.nsh

Var ShortcutsDialog
Var CheckboxDesktop
Var CheckboxDesktop_State

Function ShortcutsPageCreate
  nsDialogs::Create 1018
  Pop $ShortcutsDialog
  ${If} $ShortcutsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 16u "Opções de Atalho"
  Pop $0

  ${NSD_CreateLabel} 0 20u 100% 24u "Selecione se deseja criar um atalho para acesso rápido ao CondoBox Portaria:"
  Pop $0

  ${NSD_CreateCheckbox} 10u 48u 90% 14u "Criar um atalho na Área de Trabalho"
  Pop $CheckboxDesktop

  # Pre-marcado por padrão (Checked by default: 1)
  ${If} $CheckboxDesktop_State == ""
    StrCpy $CheckboxDesktop_State 1
  ${EndIf}

  ${NSD_SetState} $CheckboxDesktop $CheckboxDesktop_State

  nsDialogs::Show
FunctionEnd

Function ShortcutsPageLeave
  ${NSD_GetState} $CheckboxDesktop $CheckboxDesktop_State
FunctionEnd

!macro customPageAfterChangeDir
  Page custom ShortcutsPageCreate ShortcutsPageLeave
!macroend

!macro customInit
  StrCpy $CheckboxDesktop_State "1"
!macroend

!macro customInstall
  ${If} $CheckboxDesktop_State == "0"
    DetailPrint "Removendo atalho da Área de Trabalho..."
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
