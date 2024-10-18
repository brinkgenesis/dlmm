import axios, { AxiosInstance } from 'axios';
import { METEORA_API_BASE_URL } from '../constants';

export class ApiClient {
  private apiKey: string;
  private axiosInstance: AxiosInstance;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.axiosInstance = axios.create({
      baseURL: METEORA_API_BASE_URL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
  }

  async getDynamicFee(): Promise<number> {
    const response = await this.axiosInstance.get('/dynamic-fee');
    return response.data.fee;
  }

  // Additional methods for interacting with the Meteora DLMM API
}
