export class NetworkStatusService {
  private static isOnline: boolean = navigator.onLine;
  private static listeners: ((status: boolean) => void)[] = [];

  static init() {
    window.addEventListener("online", () => this.updateStatus(true));
    window.addEventListener("offline", () => this.updateStatus(false));
  }

  private static updateStatus(status: boolean) {
    this.isOnline = status;
    this.listeners.forEach(l => l(status));
    window.dispatchEvent(new CustomEvent("network-status-changed", { detail: status }));
  }

  static getStatus(): boolean {
    return this.isOnline;
  }

  static subscribe(listener: (status: boolean) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

NetworkStatusService.init();
