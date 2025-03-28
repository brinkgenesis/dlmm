import { Config } from '../src/models/Config';
import { PositionStorage } from '../src/utils/PositionStorage';
import { PositionRepository } from '../src/services/positionRepository';
import fs from 'fs';
import path from 'path';
import { PublicKey } from '@solana/web3.js';

async function migratePositions() {
  try {
    // Load config
    const config = await Config.load();
    
    // Load JSON data
    const jsonPath = path.resolve(config.dataDirectory, 'positions.json');
    if (!fs.existsSync(jsonPath)) {
      console.log('No positions.json file found. Nothing to migrate.');
      return;
    }
    
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`Loaded ${Object.keys(jsonData).length} positions from JSON file`);
    
    // Create position repository
    const positionRepository = new PositionRepository();
    
    // Migrate each position
    for (const [key, data] of Object.entries(jsonData)) {
      console.log(`Migrating position ${key}...`);
      
      try {
        await positionRepository.syncPosition(key, data);
        console.log(`✅ Successfully migrated position ${key}`);
      } catch (error) {
        console.error(`❌ Failed to migrate position ${key}:`, error);
      }
    }
    
    console.log('Migration complete!');
    
    // Rename the original file as backup
    const backupPath = `${jsonPath}.bak`;
    fs.renameSync(jsonPath, backupPath);
    console.log(`Original file backed up to ${backupPath}`);
    
    // After successful migration, create a flag file
    const flagPath = path.resolve(config.dataDirectory, '.migrated_to_supabase');
    fs.writeFileSync(flagPath, new Date().toISOString());
    console.log(`Created migration flag at ${flagPath}`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

// Run the migration
migratePositions().catch(console.error); 