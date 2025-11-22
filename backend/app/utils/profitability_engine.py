# # app/profitability_engine.py
# from dataclasses import dataclass
# from typing import Dict, List

# @dataclass
# class TokenAnalysis:
#     mint: str
#     risk_score: float
#     moon_potential: float
#     sentiment_score: float
#     holder_concentration: float
#     liquidity_score: float
#     social_score: float
#     technical_score: float
#     final_score: float
#     confidence: float
#     recommendation: str
#     reasons: List[str]

# class ProfitabilityEngine:
#     def __init__(self):
#         self.weights = {
#             'risk': -0.50,
#             'moon_potential': 0.35,
#             'liquidity': 0.25,
#             'holder_distribution': -0.30,
#             'socials': 0.10,
#             'technical': 0.15,
#         }

#         self.THRESHOLDS = {
#             'MAX_RISK': 32,
#             'MIN_MOON': 82,
#             'MAX_HOLDER_CONCENTRATION': 48,
#             'MIN_LIQUIDITY_SCORE': 88,
#             'MIN_CONFIDENCE': 78,
#             'MIN_FINAL_SCORE_MOONBAG': 88,
#         }

#     async def analyze_token(self, mint: str, token_data: Dict, webacy_data: Dict,
#                           raydium_data: Dict) -> TokenAnalysis:

#         risk_score = webacy_data.get("risk_score", 100)
#         moon_potential = webacy_data.get("moon_potential", 0)
#         holder_concentration = webacy_data.get("holder_concentration", 100)
#         holder_score = max(0, 100 - holder_concentration)

#         liquidity_score = self._calculate_liquidity_score(raydium_data, token_data)
#         social_score = self._calculate_social_score(token_data)
#         technical_score = self._calculate_technical_score(token_data)

#         final_score = (
#             self.weights['risk'] * max(0, 100 - risk_score) +
#             self.weights['moon_potential'] * moon_potential +
#             self.weights['holder_distribution'] * holder_score +
#             self.weights['liquidity'] * liquidity_score +
#             self.weights['socials'] * social_score +
#             self.weights['technical'] * technical_score
#         )
#         final_score = max(0, min(100, 50 + final_score))

#         recommendation, reasons = self._generate_recommendation(
#             final_score, risk_score, moon_potential, holder_concentration,
#             liquidity_score, webacy_data
#         )

#         confidence = self._calculate_confidence(webacy_data, liquidity_score, token_data)

#         return TokenAnalysis(
#             mint=mint,
#             risk_score=risk_score,
#             moon_potential=moon_potential,
#             sentiment_score=0,
#             holder_concentration=holder_concentration,
#             liquidity_score=liquidity_score,
#             social_score=social_score,
#             technical_score=technical_score,
#             final_score=final_score,
#             confidence=confidence,
#             recommendation=recommendation,
#             reasons=reasons
#         )

#     def _calculate_liquidity_score(self, raydium_data: Dict, token_data: Dict) -> float:
#         score = 0
#         if not raydium_data or not raydium_data.get("data"): return 0
#         pool = raydium_data["data"][0]
#         if pool.get("burnPercent", 0) != 100: return 0
#         tvl = pool.get("tvl", 0)
#         vol_24h = token_data.get("volume_h24", 0)
#         if tvl >= 30000: score += 50
#         elif tvl >= 15000: score += 35
#         elif tvl >= 8000: score += 20
#         if vol_24h > 150000: score += 40
#         elif vol_24h > 70000: score += 25
#         return min(100, score)

#     def _calculate_social_score(self, token_data: Dict) -> float:
#         score = 50
#         if token_data.get("socials_present"): score += 50
#         return min(100, score)

#     def _calculate_technical_score(self, token_data: Dict) -> float:
#         score = 60
#         if token_data.get("price_change_m5", 0) > 15: score += 30
#         if token_data.get("volume_m5", 0) > 50000: score += 10
#         return min(100, score)

#     def _calculate_confidence(self, webacy_data: Dict, liquidity_score: float, token_data: Dict) -> float:
#         conf = 70
#         if webacy_data.get("confidence", 0) > 85: conf += 20
#         if liquidity_score >= 90: conf += 15
#         if token_data.get("volume_h24", 0) > 100000: conf += 10
#         return min(100, conf)

#     def _generate_recommendation(self, final_score, risk_score, moon_potential,
#                                holder_concentration, liquidity_score, webacy_data):
#         reasons = []
#         if risk_score > 60: reasons.append("High risk")
#         if holder_concentration > 60: reasons.append("Dev/sniper hold")
#         if liquidity_score < 80: reasons.append("LP not safe")

#         if (risk_score <= self.THRESHOLDS['MAX_RISK'] and
#             moon_potential >= self.THRESHOLDS['MIN_MOON'] and
#             holder_concentration <= self.THRESHOLDS['MAX_HOLDER_CONCENTRATION'] and
#             liquidity_score >= self.THRESHOLDS['MIN_LIQUIDITY_SCORE'] and
#             final_score >= self.THRESHOLDS['MIN_FINAL_SCORE_MOONBAG'] and
#             not webacy_data.get("is_honeypot") and
#             not webacy_data.get("has_mint_authority") and
#             not webacy_data.get("has_freeze")):
#             return "MOONBAG_BUY", ["ULTRA SAFE MOONBAG"]

#         if final_score >= 78: return "STRONG_BUY", reasons or ["Strong signals"]
#         if final_score >= 68: return "BUY", reasons or ["Good setup"]
#         return "SKIP", reasons or ["Does not meet criteria"]

# profitability_engine = ProfitabilityEngine()







# app/profitability_engine.py
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class TokenAnalysis:
    mint: str
    risk_score: float
    moon_potential: float
    sentiment_score: float
    holder_concentration: float
    liquidity_score: float
    social_score: float
    technical_score: float
    final_score: float
    confidence: float
    recommendation: str
    reasons: List[str]

class ProfitabilityEngine:
    def __init__(self):
        self.weights = {
            'risk': -0.50,
            'moon_potential': 0.40,
            'liquidity': 0.30,
            'holder_distribution': -0.35,
            'socials': 0.15,
            'technical': 0.20,
        }

        self.THRESHOLDS = {
            'MAX_RISK': 32,
            'MIN_MOON': 85,
            'MAX_HOLDER_CONCENTRATION': 45,
            'MIN_LIQUIDITY_SOL': 15,        # from Webacy liquidity
            'MIN_VOLUME_24H': 80000,
            'MIN_FINAL_SCORE_MOONBAG': 90,
            'MIN_CONFIDENCE': 82,
        }

    async def analyze_token(self, mint: str, token_data: Dict, webacy_data: Dict) -> TokenAnalysis:
        # Extract from Webacy
        risk_score = webacy_data.get("risk_score", 100)
        moon_potential = webacy_data.get("moon_potential", 0)
        top10_pct = webacy_data.get("holder_concentration", {}).get("top10_percentage", 100)
        holder_concentration = top10_pct
        total_liquidity_sol = webacy_data.get("liquidity_analysis", {}).get("total_liquidity", 0)

        # DexScreener data
        price_usd = token_data.get("price_usd", 0)
        market_cap = token_data.get("market_cap", 0)
        volume_24h = token_data.get("volume_h24", 0)
        price_change_m5 = token_data.get("price_change_m5", 0)
        socials_present = token_data.get("socials_present", False)

        # === SCORES ===
        holder_score = max(0, 100 - holder_concentration)

        liquidity_score = 0
        if total_liquidity_sol >= 50: liquidity_score = 100
        elif total_liquidity_sol >= 30: liquidity_score = 90
        elif total_liquidity_sol >= 15: liquidity_score = 80
        elif total_liquidity_sol >= 8: liquidity_score = 60
        else: liquidity_score = 30

        social_score = 100 if socials_present else 30

        technical_score = 60
        if price_change_m5 > 30: technical_score += 40
        elif price_change_m5 > 15: technical_score += 25
        if volume_24h > 200000: technical_score += 20

        # Final weighted score
        final_score = (
            self.weights['risk'] * max(0, 100 - risk_score) +
            self.weights['moon_potential'] * moon_potential +
            self.weights['holder_distribution'] * holder_score +
            self.weights['liquidity'] * liquidity_score +
            self.weights['socials'] * social_score +
            self.weights['technical'] * technical_score
        )
        final_score = max(0, min(100, 45 + final_score))  # normalized to 0–100

        # Confidence
        confidence = 75
        if webacy_data.get("confidence", 0) > 90: confidence += 20
        if volume_24h > 100000: confidence += 15
        if socials_present: confidence += 10
        confidence = min(100, confidence)

        # === RECOMMENDATION ===
        reasons = []
        if risk_score > 50: reasons.append("High risk score")
        if holder_concentration > 60: reasons.append("Snipers/dev hold heavy")
        if total_liquidity_sol < 10: reasons.append("Low liquidity")
        if not socials_present: reasons.append("No socials")

        is_honeypot = webacy_data.get("issues") and any("honeypot" in str(i).lower() for i in webacy_data["issues"])
        has_mint = webacy_data.get("token_metadata", {}).get("has_mint_authority", True)

        if (risk_score <= self.THRESHOLDS['MAX_RISK'] and
            moon_potential >= self.THRESHOLDS['MIN_MOON'] and
            holder_concentration <= self.THRESHOLDS['MAX_HOLDER_CONCENTRATION'] and
            total_liquidity_sol >= self.THRESHOLDS['MIN_LIQUIDITY_SOL'] and
            volume_24h >= self.THRESHOLDS['MIN_VOLUME_24H'] and
            final_score >= self.THRESHOLDS['MIN_FINAL_SCORE_MOONBAG'] and
            confidence >= self.THRESHOLDS['MIN_CONFIDENCE'] and
            not is_honeypot and
            not has_mint):
            recommendation = "MOONBAG_BUY"
            reasons = ["ULTRA RARE MOONBAG", "Webacy approved", "Strong liquidity", "Good distribution"]
        elif final_score >= 82:
            recommendation = "STRONG_BUY"
        elif final_score >= 72:
            recommendation = "BUY"
        else:
            recommendation = "SKIP"

        return TokenAnalysis(
            mint=mint,
            risk_score=risk_score,
            moon_potential=moon_potential,
            sentiment_score=0,
            holder_concentration=holder_concentration,
            liquidity_score=liquidity_score,
            social_score=social_score,
            technical_score=technical_score,
            final_score=final_score,
            confidence=confidence,
            recommendation=recommendation,
            reasons=reasons
        )

engine = ProfitabilityEngine()

