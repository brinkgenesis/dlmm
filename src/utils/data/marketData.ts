import axios from 'axios';

export interface VolumeData {
  timestamp: number; // UNIX milliseconds
  volume: number;    // USD volume
}

export async function fetchVolumeHistory(
  tokenMint: string,
  startTime: number,
  endTime: number
): Promise<VolumeData[]> {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        from: Math.floor(startTime / 1000),
        to: Math.floor(endTime / 1000),
        interval: 'hourly'
      }
    });

    return response.data.map((entry: any) => ({
      timestamp: entry[0],
      volume: entry[1]
    }));
    
  } catch (error) {
    console.error('Failed to fetch volume history:', error);
    return [];
  }
} 