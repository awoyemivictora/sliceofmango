import { config } from "@/config/production";



class ApiService {
  private baseUrl: string;
  private wsUrl: string;

  constructor() {
    this.baseUrl = config.api.baseUrl;
    this.wsUrl = config.api.wsUrl;
    // console.log('ApiService initialized:', { baseUrl: this.baseUrl, wsUrl: this.wsUrl });
    if (!this.baseUrl) {
      throw new Error('baseUrl is empty. Ensure VITE_API_URL is set in .env');
    }
    if (!this.baseUrl.startsWith('http:') && !this.baseUrl.startsWith('https:')) {
      throw new Error(`Invalid baseUrl: ${this.baseUrl}. Must start with http: or https:`);
    }
  }

  // async request(endpoint: string, options: RequestInit = {}) {
  //   const url = `${this.baseUrl}${endpoint}`;
  //   const token = localStorage.getItem('authToken');
  //   const walletAddress = localStorage.getItem('walletAddress');

  //   const headers = new Headers({
  //     'Content-Type': 'application/json',
  //     ...(token && { Authorization: `Bearer ${token}` }),
  //     ...(walletAddress && { 'wallet-address': walletAddress }),
  //     ...(options.headers as Record<string, string> || {}),
  //   });

  //   const controller = new AbortController();
  //   const timeoutId = setTimeout(() => controller.abort(), 60000);

  //   try {
  //     const response = await fetch(url, {
  //       ...options,
  //       headers,
  //       signal: controller.signal,
  //     });

  //     // AUTO HANDLE 401: JWT EXPIRED → FORCE RE-LOGIN
  //     if (response.status === 401) {
  //       const text = await response.text();
  //       if (text.includes('TOKEN_EXPIRED') || text.includes('Signature has expired')) {
  //         localStorage.removeItem('authToken');
  //         window.dispatchEvent(new CustomEvent('auth-expired'));
  //       }
  //       throw new Error('Authentication expired');
  //     }

  //     if (!response.ok) {
  //       const errorText = await response.text();
  //       throw new Error(`HTTP ${response.status}: ${errorText}`);
  //     }

  //     return await response.json();
  //   } catch (error: any) {
  //     if (error.name === 'AbortError') {
  //       throw new Error('Request timed out');
  //     }
  //     throw error;
  //   } finally {
  //     clearTimeout(timeoutId);
  //   }
  // }

  async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const token = localStorage.getItem('authToken');
    const walletAddress = localStorage.getItem('walletAddress');

    // Create headers object
    const headers = new Headers();
    
    // Only set Content-Type if it's NOT FormData
    if (!(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    
    // Add auth headers
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    
    if (walletAddress) {
      headers.set('wallet-address', walletAddress);
    }
    
    // Add any custom headers from options
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers.set(key, value);
        });
      } else if (typeof options.headers === 'object') {
        Object.entries(options.headers).forEach(([key, value]) => {
          headers.set(key, value as string);
        });
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      // AUTO HANDLE 401: JWT EXPIRED → FORCE RE-LOGIN
      if (response.status === 401) {
        const text = await response.text();
        if (text.includes('TOKEN_EXPIRED') || text.includes('Signature has expired')) {
          localStorage.removeItem('authToken');
          window.dispatchEvent(new CustomEvent('auth-expired'));
        }
        throw new Error('Authentication expired');
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  createWebSocket(walletAddress: string): WebSocket {
    const ws = new WebSocket(`${this.wsUrl}/ws/logs/${walletAddress}`);

    ws.onopen = () => {
      // console.log('WebSocket connected');
      const token = localStorage.getItem('authToken');
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onclose = (event) => {
      // console.log('WebSocket disconnected:', event.code, event.reason);
      if (event.code !== 1000) {
        setTimeout(() => this.createWebSocket(walletAddress), 5000);
      }
    };

    return ws;
  }
}

export const apiService = new ApiService();


if (typeof window !== 'undefined') {
  window.addEventListener('auth-expired', () => {
    // Clear UI state
    localStorage.removeItem('authToken');
    
    // Force full re-login (this will trigger your wallet reconnect flow)
    alert('Session expired. Reconnecting wallet...');
    window.location.reload();
  });
}

