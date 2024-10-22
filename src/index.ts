import { Config } from './models/Config';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  
  const config = Config.load();


}



main();
