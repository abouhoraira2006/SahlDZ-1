interface Window {
  __ELECTRON__?: boolean;
  electronAPI?: {
    getConfig: () => Promise<unknown>;
    saveConfig: (config: unknown) => Promise<boolean>;
    clearConfig: () => Promise<boolean>;
    logout: () => Promise<unknown>;
    reloadApp: () => Promise<unknown>;
    getAppUrl: () => Promise<string>;
    getAppVersion: () => Promise<string>;
    getPlatform: () => Promise<string>;
    isElectron: true;
    openExternal: (url: string) => Promise<unknown>;
    getPrintCapabilities: () => Promise<{
      supported: boolean;
      sumatra: boolean;
      reason?: string;
      tempDir?: string;
    }>;
    listPrinters: () => Promise<{ name: string; isDefault: boolean }[]>;
    printTicket: (opts: {
      html: string;
      printerName?: string | null;
      copies?: number;
      jobName?: string;
    }) => Promise<{
      ok: boolean;
      reason?: string;
      printer?: string | null;
      copies?: number;
    }>;
    checkForUpdates: () => Promise<unknown>;
    installUpdate: () => Promise<boolean>;
  };
}
