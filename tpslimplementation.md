We've recently implemented take profit and stop loss functionality in the backend. I'd like you to update the frontend to support these features. Here's what you need to know:

# Frontend Implementation: Take Profit & Stop Loss Features

## 1. Backend Changes Overview

We've added:
- Take profit and stop loss fields to the positions database
- A `PositionTriggerMonitor` class that continuously checks if positions hit their triggers
- API endpoints for creating and managing triggers
- Integration with the existing position management system

## 2. Key API Endpoints

### Create Position with Triggers
POST /api/markets/select
{
"marketPublicKey": "string",
"singleSidedX": boolean,
"dollarAmount": number,
"takeProfitPrice": number, // Optional
"stopLossPrice": number // Optional
}

### Update Triggers for Existing Position
POST /api/positions/triggers
{
"positionKey": "string",
"takeProfitPrice": number, // Optional, omit to keep current value
"stopLossPrice": number // Optional, omit to keep current value
}


### Get Position Data
The existing `/api/positions` endpoint now includes:
```json
{
  "positions": [
    {
      "publicKey": "string",
      // Other existing fields...
      "takeProfitPrice": number | null,
      "stopLossPrice": number | null
    }
  ]
}
```

## 3. Frontend Implementation Tasks

Please review the following files and implement necessary UI components:

1. **Position Creation Form**:
   - Add optional numeric input fields for take profit and stop loss prices
   - Include validation (TP > current price, SL < current price)
   - Enhance API calls to include these parameters

2. **Position Details View**:
   - Display current take profit and stop loss values
   - Add form/UI to update these values
   - Add button/option to clear triggers

3. **Positions Dashboard**:
   - Update position listing to show trigger information
   - Consider adding visual indicators (proximity to triggers)
   - Update data fetching to handle the new fields

## 4. Validation Rules

- Take profit price must be greater than current price
- Stop loss price must be less than current price
- Both fields should be optional
- Consider adding a minimum gap between current price and triggers (e.g., 5%)
- Ensure proper numeric formatting (match decimals to token precision)

## 5. UI/UX Considerations

- Use clear, intuitive labels like "Take Profit Price ($)" and "Stop Loss Price ($)"
- Consider using a slider component for visual price selection
- Add tooltips explaining the concepts
- Use green/red color coding for take profit/stop loss
- Show a visualization of current price vs trigger prices if possible

## 6. Mock-Up Suggestions

### Position Creation Form
```jsx
<FormControl>
  <FormLabel>Take Profit Price ($)</FormLabel>
  <Tooltip label="Price at which position will automatically close for profit">
    <Input 
      type="number" 
      placeholder="Optional" 
      value={takeProfitPrice} 
      onChange={handleTakeProfitChange} 
      min={currentPrice * 1.05} // 5% above current price
    />
  </Tooltip>
</FormControl>

<FormControl>
  <FormLabel>Stop Loss Price ($)</FormLabel>
  <Tooltip label="Price at which position will automatically close to limit losses">
    <Input 
      type="number" 
      placeholder="Optional" 
      value={stopLossPrice} 
      onChange={handleStopLossChange} 
      max={currentPrice * 0.95} // 5% below current price
    />
  </Tooltip>
</FormControl>
```

### Position Details Card
```jsx
<Card>
  <CardHeader>
    <Heading size="md">Position Triggers</Heading>
  </CardHeader>
  <CardBody>
    <Flex direction="column" gap={4}>
      <Flex justify="space-between">
        <Text>Take Profit:</Text>
        <Badge colorScheme="green">
          {position.takeProfitPrice ? `$${position.takeProfitPrice.toFixed(4)}` : 'Not Set'}
        </Badge>
      </Flex>
      <Flex justify="space-between">
        <Text>Stop Loss:</Text>
        <Badge colorScheme="red">
          {position.stopLossPrice ? `$${position.stopLossPrice.toFixed(4)}` : 'Not Set'}
        </Badge>
      </Flex>
      <Button 
        size="sm" 
        onClick={handleEditTriggers}
      >
        Edit Triggers
      </Button>
    </Flex>
  </CardBody>
</Card>
```

Happy to provide more specific implementation details if needed!