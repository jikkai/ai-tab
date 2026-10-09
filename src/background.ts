chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  console.error(chrome.i18n.getMessage('sidePanelError'));
});

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {
  console.error(chrome.i18n.getMessage('storageError'));
});
