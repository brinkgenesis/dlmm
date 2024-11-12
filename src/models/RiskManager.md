Re DLMM pool. 

Prompt User for Token Pair             

Create a list of cases for token pairs. Maybe a json list with all the token pairs and their addresses. When user enters the token pair it will select the case and initalize the pool. 


RiskManager.MD

Prompt use case, set risk settings. Return bin parameters for token pair. 

Define Risk Cases

Determine the price range to enter. Set 3 price concentration cases. High risk, medium, low risk.
High risk: price spread +5/-5%
Medium risk: price spread +10/-10% 
Low risk: price spread +15/-15%

Prompt User Input for Case to Use
Set the parameters for the bins based on this price range. Requires token pair passed from main function

Risk settings will calculate the bin parameters and pass it to the execution logic

Create the position and add liquidity.


Use the bin parameters, take total SOL input, use swap function to buy half in token B then deposit.

Convert to number of bins by figuring out the amount of bins and the use 

Have the monitoring logic determine to keep or exit the position. Loop logic.
Use voilitily measure to determine EV of holding the position vs breaking it. 
If a position is set for rebalance, then liquidity is withdrawn, swapping enough of excess token A to B and vice versa. Determining the new price range. And re-entering the position. Add this to PositionManager.