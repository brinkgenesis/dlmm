import * as AWS from 'aws-sdk';
import * as fs from 'fs';

AWS.config.update({ region: 'us-east-1' });

export async function deploy() {
  const lambda = new AWS.Lambda();
  const functionZip = fs.readFileSync('dist/function.zip');

  const params = {
    FunctionName: 'MeteoraDLMMBot',
    Runtime: 'nodejs14.x',
    Role: 'arn:aws:iam::your-account-id:role/your-lambda-role',
    Handler: 'index.handler',
    Code: { ZipFile: functionZip },
    Description: 'Meteora DLMM Liquidity Management Bot',
    Timeout: 300
  };

  try {
    await lambda.createFunction(params).promise();
    console.log('Deployment successful.');
  } catch (error) {
    console.error('Deployment failed:', error);
  }
}

deploy();
