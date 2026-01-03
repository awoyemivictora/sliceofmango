// import { LaunchConfig } from '@/services/tokenLaunch';

// export interface BackendLaunchConfig {
//   use_ai_metadata?: boolean;
//   custom_metadata?: any;
//   bot_count?: number;
//   creator_buy_amount?: number;
//   bot_buy_amount?: number;
//   sell_strategy_type?: 'volume_based' | 'time_based' | 'price_target';
//   sell_volume_target?: number;
//   sell_price_target?: number;
//   sell_time_minutes?: number;
//   metadata_style?: string;
//   use_jito_bundle?: boolean;
//   priority?: number;
// }

// export const convertToBackendConfig = (
//     config: LaunchConfig,
//     atomicLaunchMode?: boolean
// ): any => {
//   return {
//     // Core token info
//     token_name: config.tokenName,
//     token_symbol: config.tokenSymbol,
//     token_description: config.tokenDescription,
//     image_url: config.imageUrl,
//     creator_wallet: config.creatorWallet,
    
//     // Bot configuration
//     bot_count: config.botCount,
//     bot_wallet_buy_amount: config.botWalletBuyAmount,
//     creator_buy_amount: config.creatorBuyAmount,
    
//     // Strategy
//     target_profit_percentage: config.targetProfitPercentage,
//     sell_timing: config.sellTiming,
//     sell_volume_trigger: config.sellVolumeTrigger,
//     sell_time_trigger: config.sellTimeTrigger,
//     sell_price_target: config.sellPriceTarget,
    
//     // AI Metadata
//     use_ai_for_metadata: config.useAIForMetadata,
//     metadata_style: config.metadataStyle,
//     metadata_keywords: config.metadataKeywords,
//     use_dalle: config.useDalle,
    
//     // Advanced settings
//     initial_sol_reserves: config.initialSolReserves,
//     use_jito_bundle: config.useJitoBundle,
//     priority: config.priority,
//     bot_spread: config.botSpread,
    
//     // For atomic launch
//     atomic_mode: atomicLaunchMode,
//   };
// };

// export function getSellStrategyType(sellTiming?: string): 'volume_based' | 'time_based' | 'price_target' {
//   if (!sellTiming) return 'volume_based';
  
//   // Convert any format to backend format
//   const timing = sellTiming.toLowerCase().replace('-', '_');
  
//   if (timing === 'volume_based' || timing === 'volume') {
//     return 'volume_based';
//   } else if (timing === 'time_based' || timing === 'time') {
//     return 'time_based';
//   } else if (timing === 'price_target' || timing === 'price') {
//     return 'price_target';
//   }
  
//   return 'volume_based';
// }

// // Helper to calculate pre-fund amount
// export function calculatePreFundAmount(buyAmount: number, multiplier: number = 2): number {
//   return buyAmount * multiplier;
// }

// // Helper to check if pre-funded bots are sufficient
// export function hasSufficientPreFunded(
//   preFundedBots: any[],
//   requiredCount: number,
//   requiredAmount: number
// ): boolean {
//   if (preFundedBots.length < requiredCount) return false;
  
//   const availableBots = preFundedBots
//     .filter(bot => bot.is_pre_funded && bot.pre_funded_amount >= requiredAmount)
//     .slice(0, requiredCount);
    
//   return availableBots.length >= requiredCount;
// }





import { LaunchConfig, SimpleMetadataResponse } from '@/services/tokenLaunch';

export interface BackendLaunchConfig {
  use_ai_metadata?: boolean;
  custom_metadata?: any;
  bot_count?: number;
  creator_buy_amount?: number;
  bot_buy_amount?: number;
  sell_strategy_type?: 'volume_based' | 'time_based' | 'price_target' | 'immediate';
  sell_volume_target?: number;
  sell_price_target?: number;
  sell_time_minutes?: number;
  metadata_style?: string;
  use_jito_bundle?: boolean;
  priority?: number;
}

// ✅ NEW: Interface for the simplified custom metadata
export interface CustomMetadataForBackend {
  name?: string;
  symbol?: string;
  description?: string;
  uri?: string;        // ✅ Changed from metadata_uri to uri
  image?: string;      // ✅ Changed from image_url to image
  attributes?: Array<{trait_type: string; value: string}>;
}

// export const convertToBackendConfig = (
//     config: LaunchConfig,
//     atomicLaunchMode?: boolean
// ): BackendLaunchConfig => {
  
//   // ✅ Extract custom metadata from config
//   let custom_metadata: CustomMetadataForBackend | undefined;
  
//   if (config.customMetadata) {
//     // If we already have custom metadata with metadata_uri
//     custom_metadata = {
//       name: config.customMetadata.name || config.tokenName,
//       symbol: config.customMetadata.symbol || config.tokenSymbol,
//       description: config.customMetadata.description || config.tokenDescription,
//       uri: config.customMetadata.metadata_uri, // ✅ Changed to 'uri'
//       image: config.customMetadata.image_url || config.imageUrl, // ✅ Changed to 'image'
//       attributes: config.customMetadata.attributes
//     };
    
//     console.log('🔧 Config Converter: Custom metadata with URI:', 
//       custom_metadata.uri ? `${custom_metadata.uri.substring(0, 50)}...` : 'No URI');
//   } 
//   // ✅ If we have AI-generated metadata stored in the main config
//   else if (config.useAIForMetadata && config.tokenName && config.tokenSymbol) {
//     custom_metadata = {
//       name: config.tokenName,
//       symbol: config.tokenSymbol,
//       description: config.tokenDescription,
//       // Note: uri won't be available here unless from AI generation
//       image: config.imageUrl
//     };
//   }
  
//   const backendConfig: BackendLaunchConfig = {
//     // ✅ If we have custom metadata with metadata_uri, don't use AI
//     use_ai_metadata: custom_metadata?.uri ? false : (config.useAIForMetadata ?? true),
    
//     // ✅ Pass the custom metadata (with metadata_uri if available)
//     custom_metadata: custom_metadata,
    
//     // Core launch configuration
//     bot_count: config.botCount,
//     creator_buy_amount: config.creatorBuyAmount,
//     bot_buy_amount: config.botWalletBuyAmount,
    
//     // Strategy configuration
//     sell_strategy_type: getSellStrategyType(config.sellTiming),
//     // Ensure minimum values are always sent
//     sell_volume_target: config.sellTiming === 'volume_based' ? 
//       Math.max(config.sellVolumeTrigger || 0, 5.0) : 5.0,
    
//     sell_time_minutes: config.sellTiming === 'time_based' ? 
//       Math.max(config.sellTimeTrigger || 0, 1) : 1,
    
//     sell_price_target: config.sellTiming === 'price_target' ? 
//       Math.max(config.sellPriceTarget || 0, 1.1) : 1.1,
    
//     // AI/UI settings
//     metadata_style: config.metadataStyle ?? 'ai-generated',
    
//     // Performance settings
//     use_jito_bundle: config.useJitoBundle ?? true,
//     priority: config.priority ?? 10,
//   };
  
//   // ✅ Debug logging
//   console.log('📤 Config Converter Output:', {
//     use_ai_metadata: backendConfig.use_ai_metadata,
//     has_custom_metadata: !!backendConfig.custom_metadata,
//     has_metadata_uri: !!backendConfig.custom_metadata?.metadata_uri,
//     bot_count: backendConfig.bot_count,
//     strategy: backendConfig.sell_strategy_type
//   });
  
//   return backendConfig;
// };

// In your configConverter.ts
export const convertToBackendConfig = (config: LaunchConfig): BackendLaunchConfig => {
  const backendConfig: BackendLaunchConfig = {
    use_ai_metadata: config.useAIForMetadata ?? true,
    bot_count: config.botCount ?? 10,
    creator_buy_amount: config.creatorBuyAmount ?? 0.5,
    bot_buy_amount: config.botWalletBuyAmount ?? 0.1,
    sell_strategy_type: config.sellTiming || 'volume_based',
    sell_volume_target: config.sellVolumeTrigger || (config.sellTiming === 'volume_based' ? 5.0 : 0),
    sell_price_target: config.sellPriceTarget || (config.sellTiming === 'price_target' ? 2.0 : 0),
    sell_time_minutes: config.sellTimeTrigger || (config.sellTiming === 'time_based' ? 5 : 0),
    metadata_style: config.metadataStyle ?? 'ai-generated',
    use_jito_bundle: config.useJitoBundle ?? true,
    priority: config.priority ?? 10,
  };

  // ✅ Handle custom metadata with metadata_uri
  if (config.customMetadata) {
    backendConfig.custom_metadata = {
      name: config.customMetadata.name || config.tokenName,
      symbol: config.customMetadata.symbol || config.tokenSymbol,
      description: config.customMetadata.description || config.tokenDescription,
      // ✅ Ensure URI is included for on-chain
      uri: config.customMetadata.metadata_uri || config.customMetadata.uri || config.imageUrl,
      image: config.customMetadata.image_url || config.imageUrl,
      // For backward compatibility
      metadata_uri: config.customMetadata.metadata_uri || config.customMetadata.uri,
      image_url: config.customMetadata.image_url || config.imageUrl
    };
  } else if (config.useAIForMetadata) {
    // For AI metadata, ensure we have URI
    backendConfig.use_ai_metadata = true;
  } else {
    // Manual metadata entry
    backendConfig.custom_metadata = {
      name: config.tokenName,
      symbol: config.tokenSymbol,
      description: config.tokenDescription,
      uri: config.imageUrl, // Use imageUrl as fallback URI
      image: config.imageUrl
    };
  }

  return backendConfig;
};

export function getSellStrategyType(sellTiming?: string): 'volume_based' | 'time_based' | 'price_target' | 'immediate' {
  if (!sellTiming) return 'volume_based';
  
  // Convert any format to backend format
  const timing = sellTiming.toLowerCase().replace('-', '_');
  
  switch (timing) {
    case 'volume_based':
    case 'volume':
      return 'volume_based';
    case 'time_based':
    case 'time':
      return 'time_based';
    case 'price_target':
    case 'price':
      return 'price_target';
    case 'immediate':
      return 'immediate';
    default:
      return 'volume_based';
  }
}

// ✅ NEW: Helper to create custom metadata from AI response
// export function createCustomMetadataFromAI(aiResponse: any): CustomMetadataForBackend {
//   return {
//     name: aiResponse.name,
//     symbol: aiResponse.symbol,
//     description: aiResponse.description,
//     uri: aiResponse.metadata_uri, // ✅ This is what we need!
//     image: aiResponse.image_url,
//     attributes: [
//       { trait_type: "AI Generated", value: "Yes" },
//       { trait_type: "Created On", value: new Date().toLocaleDateString() }
//     ]
//   };
// }

export const createCustomMetadataFromAI = (aiResponse: SimpleMetadataResponse) => {
  return {
    name: aiResponse.name,
    symbol: aiResponse.symbol,
    description: aiResponse.description || 'Token created via Flash Sniper',
    metadata_uri: aiResponse.metadata_uri, // ✅ This is CRITICAL
    image_url: aiResponse.image_url,
    // For compatibility with older code
    uri: aiResponse.metadata_uri,
    image: aiResponse.image_url
  };
};


// ✅ NEW: Helper to validate if we have everything needed for launch
export function validateMetadataForLaunch(config: LaunchConfig): {
  isValid: boolean;
  missingFields: string[];
  hasMetadataUri: boolean;
} {
  const missingFields: string[] = [];
  
  // Check required fields
  if (!config.tokenName.trim()) missingFields.push('Token Name');
  if (!config.tokenSymbol.trim()) missingFields.push('Token Symbol');
  
  // Check if we have metadata_uri (preferred for on-chain)
  const hasMetadataUri = !!config.customMetadata?.metadata_uri;
  
  return {
    isValid: missingFields.length === 0,
    missingFields,
    hasMetadataUri
  };
}

// Helper to calculate pre-fund amount
export function calculatePreFundAmount(buyAmount: number, multiplier: number = 2): number {
  return buyAmount * multiplier;
}

// Helper to check if pre-funded bots are sufficient
export function hasSufficientPreFunded(
  preFundedBots: any[],
  requiredCount: number,
  requiredAmount: number
): boolean {
  if (preFundedBots.length < requiredCount) return false;
  
  const availableBots = preFundedBots
    .filter(bot => bot.is_pre_funded && bot.pre_funded_amount >= requiredAmount)
    .slice(0, requiredCount);
    
  return availableBots.length >= requiredCount;
}


