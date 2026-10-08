# Fruit Database QA & Macro Accuracy Audit Report

**Date:** 2026-10-08  
**Reference Ground Truth:** USDA FoodData Central SR Legacy & ICMR-NIN IFCT 2017 (per 100g raw)  

## 1. Executive Summary

| Metric | Value | Percentage |
| :--- | :--- | :--- |
| **Total Reference Fruits Tested** | **52** | 100% |
| **Fruits Found in Database** | **39** | **75%** |
| **🟢 Exact / High Accuracy (<10% error)** | **2** | 4% |
| **🟡 Acceptable Natural Variance (<20% error)** | **8** | 15% |
| **🟠 High Divergence (>25% error)** | **10** | 19% |
| **🔴 Critical Anomaly (Unit/Scaling Error)** | **19** | 37% |
| **❌ Missing Fruits** | **13** | 25% |

### Source Layer Distribution for Found Fruits
- **IFCT 2017 (Gold Standard Indian):** 0
- **INDB (Indian Nutrient Database):** 12
- **Open Food Facts (Crowdsourced):** 27
- **User Created:** 0

## 2. Complete Fruit Verification Matrix

| Fruit | Status / Tier | DB Match Name | Source | DB Cal (Ref) | DB Carb (Ref) | DB Fiber (Ref) | Servings Defined | Issues / Diagnostics |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Apple** | 🔴 Critical | Apple mousse | `INDB` | 106.9 (52) | 12.77 (13.8) | 1.6 (2.4) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Missing practical piece / cup serving sizes |
| **Banana** | 🔴 Critical | Banana appam | `INDB` | 469.8 (89) | 20.06 (22.8) | 0.67 (2.6) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Excess fat reported: Ref 0.3g vs DB 42.53g; Missing practical piece / cup serving sizes |
| **Orange** | 🟡 Acceptable | Orange | `OPEN_FOOD_FACTS` | 41 (47) | 9.3 (11.8) | 0.8 (2.4) | 1 | None (Passed) |
| **Mango** | 🟡 Acceptable | Mango | `OPEN_FOOD_FACTS` | 47 (60) | 11.2 (15) | 10 (1.6) | 1 | Atwater energy mismatch (Reported: 47 kcal, Computed: 64.8 kcal) |
| **Watermelon** | 🟢 Exact | Watermelon | `OPEN_FOOD_FACTS` | 33 (30) | 6.9 (7.6) | 0.5 (0.4) | 1 | Missing practical piece / cup serving sizes |
| **Pineapple** | 🟠 High Div | Pineapple | `OPEN_FOOD_FACTS` | 75 (50) | 18 (13.1) | 18 (1.4) | 1 | Atwater energy mismatch (Reported: 75 kcal, Computed: 108.8 kcal); Missing practical piece / cup serving sizes |
| **Papaya** | 🔴 Critical | Raw papaya with coconut (Papaya thoran) | `INDB` | 132.8 (43) | 5.58 (10.8) | 4.31 (1.7) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Excess fat reported: Ref 0.3g vs DB 11.42g; Missing practical piece / cup serving sizes |
| **Guava** | 🟡 Acceptable | Guava Nectar | `OPEN_FOOD_FACTS` | 52 (68) | 13.2 (14.3) | 0 (5.4) | 1 | Missing dietary fiber (Ref: 5.4g, DB: 0g) |
| **Strawberry** | 🟡 Acceptable | Strawberries | `OPEN_FOOD_FACTS` | 39 (32) | 6.1 (7.7) | 3.8 (2) | 1 | Missing practical piece / cup serving sizes |
| **Blueberry** | 🔴 Critical | Strawberry & blueberry | `OPEN_FOOD_FACTS` | 435 (57) | 48 (14.5) | 21 (2.4) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 14.5g vs DB 48g; Excess fat reported: Ref 0.3g vs DB 19g; Missing practical piece / cup serving sizes |
| **Blackberry** | 🔴 Critical | Blueberry Blackberry | `OPEN_FOOD_FACTS` | 375 (43) | 72.5 (9.6) | 7.5 (5.3) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 9.6g vs DB 72.5g; Excess fat reported: Ref 0.5g vs DB 6.3g; Missing practical piece / cup serving sizes |
| **Raspberry** | 🔴 Critical | Raspberry bavarian cream | `INDB` | 150.1 (52) | 17.82 (11.9) | 2.19 (6.5) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Excess fat reported: Ref 0.7g vs DB 7.88g |
| **Grapes** | 🟢 Exact | 6 oz. Red Seedless Grapes | `OPEN_FOOD_FACTS` | 70.6 (69) | 18.2 (18.1) | 1.2 (0.9) | 1 | Missing practical piece / cup serving sizes |
| **Kiwi** | 🔴 Critical | Kiwi granola pudding | `INDB` | 281 (61) | 32.33 (14.7) | 3.71 (3) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 14.7g vs DB 32.33g; Excess fat reported: Ref 0.5g vs DB 15.36g; Missing practical piece / cup serving sizes |
| **Avocado** | ❌ **MISSING** | *None* | - | - (160) | - (8.5) | - (6.7) | 0 | Fruit not present in database |
| **Pomegranate** | 🟠 High Div | Pomegranate Seeds | `OPEN_FOOD_FACTS` | 55 (83) | 11.8 (18.7) | 0.6 (4) | 1 | Missing practical piece / cup serving sizes |
| **Sweet Lime** | 🔴 Critical | POPPIN' SWEET LIME & SEA SALT | `OPEN_FOOD_FACTS` | 540 (43) | 56 (10.5) | 4 (1.5) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 10.5g vs DB 56g; Excess fat reported: Ref 0.3g vs DB 34g; Missing practical piece / cup serving sizes |
| **Custard Apple** | ❌ **MISSING** | *None* | - | - (94) | - (23.6) | - (4.4) | 0 | Fruit not present in database |
| **Sapota (Chikoo)** | ❌ **MISSING** | *None* | - | - (83) | - (20) | - (5.3) | 0 | Fruit not present in database |
| **Indian Gooseberry (Amla)** | 🟠 High Div | Amla Slices | `OPEN_FOOD_FACTS` | 56.3 (44) | 10 (10.1) | 3.8 (4.3) | 1 | Missing practical piece / cup serving sizes |
| **Jamun (Black Plum)** | ❌ **MISSING** | *None* | - | - (60) | - (15.6) | - (0.9) | 0 | Fruit not present in database |
| **Jackfruit (Ripe)** | 🔴 Critical | Jackfruit/Kathal (dry) | `INDB` | 489 (95) | 4.56 (23.2) | 1.33 (1.5) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 23.2g vs DB 4.56g; Excess fat reported: Ref 0.6g vs DB 51.78g; Missing practical piece / cup serving sizes |
| **Lychee** | 🟠 High Div | lychee | `OPEN_FOOD_FACTS` | 46 (66) | 10.9 (16.5) | 0.1 (1.3) | 1 | None (Passed) |
| **Peach** | 🟠 High Div | Rehab Peach | `OPEN_FOOD_FACTS` | 12 (39) | 2.5 (9.5) | 0 (1.5) | 1 | Missing dietary fiber (Ref: 1.5g, DB: 0g) |
| **Pear** | 🔴 Critical | Pear chocholate sunday | `INDB` | 183.5 (57) | 15.02 (15.2) | 0.07 (3.1) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Excess fat reported: Ref 0.1g vs DB 13.11g; Missing practical piece / cup serving sizes |
| **Plum** | 🔴 Critical | Plum squash (Aloo bukhara squash) | `INDB` | 211.2 (46) | 55.51 (11.4) | 0.52 (1.4) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 11.4g vs DB 55.51g; Missing practical piece / cup serving sizes |
| **Cherry** | 🟠 High Div | Cherry | `OPEN_FOOD_FACTS` | 43 (63) | 10.7 (16) | 0 (2.1) | 1 | Missing dietary fiber (Ref: 2.1g, DB: 0g) |
| **Apricot** | 🔴 Critical | Apricot fool | `INDB` | 240.8 (48) | 33.64 (11.1) | 1 (2) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 11.1g vs DB 33.64g; Excess fat reported: Ref 0.4g vs DB 11.35g; Missing practical piece / cup serving sizes |
| **Muskmelon (Cantaloupe)** | ❌ **MISSING** | *None* | - | - (34) | - (8.2) | - (0.9) | 0 | Fruit not present in database |
| **Honeydew Melon** | ❌ **MISSING** | *None* | - | - (36) | - (9.1) | - (0.8) | 0 | Fruit not present in database |
| **Grapefruit** | 🟡 Acceptable | Pink Grapefruit | `OPEN_FOOD_FACTS` | 37 (42) | 8.1 (10.7) | 0 (1.6) | 1 | Missing dietary fiber (Ref: 1.6g, DB: 0g) |
| **Lemon** | 🔴 Critical | Lemon souffle | `INDB` | 168.5 (29) | 13.43 (9.3) | 0 (2.8) | 1 | Missing dietary fiber (Ref: 2.8g, DB: 0g); Suspicious high calorie scaling (Possible whole-piece base scaling error); Excess fat reported: Ref 0.3g vs DB 10.02g |
| **Lime** | 🟡 Acceptable | Citrom-Lime | `OPEN_FOOD_FACTS` | 33 (30) | 7.9 (10.5) | 0 (2.8) | 1 | Missing dietary fiber (Ref: 2.8g, DB: 0g) |
| **Dragon Fruit (Pitaya)** | 🟡 Acceptable | Dragon Fruit Mtn Dew | `OPEN_FOOD_FACTS` | 47.4 (60) | 12.4 (13) | 0 (2.9) | 1 | Missing dietary fiber (Ref: 2.9g, DB: 0g) |
| **Passion Fruit** | 🔴 Critical | Powerade Passionfruit | `OPEN_FOOD_FACTS` | 18 (97) | 4.1 (23.4) | 0 (10.4) | 1 | Missing dietary fiber (Ref: 10.4g, DB: 0g); Carbohydrate divergence: Ref 23.4g vs DB 4.1g |
| **Starfruit (Carambola)** | 🔴 Critical | Starfruit preserves | `INDB` | 128.9 (31) | 33.62 (6.7) | 0.78 (2.8) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 6.7g vs DB 33.62g; Missing practical piece / cup serving sizes |
| **Fig (Fresh)** | 🔴 Critical | Figues séchées bio | `OPEN_FOOD_FACTS` | 285 (74) | 59.9 (19.2) | 11 (2.9) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 19.2g vs DB 59.9g; Missing practical piece / cup serving sizes |
| **Coconut Meat (Fresh)** | 🔴 Critical | Coconut burfi (Nariyal ki burfi) | `INDB` | 467.6 (354) | 32.15 (15.2) | 3.5 (9) | 1 | Carbohydrate divergence: Ref 15.2g vs DB 32.15g; Missing practical piece / cup serving sizes |
| **Dates (Deglet Noor / Fresh)** | ❌ **MISSING** | *None* | - | - (282) | - (75) | - (8) | 0 | Fruit not present in database |
| **Dates (Medjool)** | ❌ **MISSING** | *None* | - | - (277) | - (75) | - (6.7) | 0 | Fruit not present in database |
| **Wood Apple (Bael)** | 🟠 High Div | Té Negro Yellow Label | `OPEN_FOOD_FACTS` | 107 (134) | 2 (31.8) | 0 (2.9) | 1 | Missing dietary fiber (Ref: 2.9g, DB: 0g); Carbohydrate divergence: Ref 31.8g vs DB 2g; Missing practical piece / cup serving sizes |
| **Jujube (Indian Plum / Ber)** | 🟠 High Div | Borowikowa z grzankami | `OPEN_FOOD_FACTS` | 30 (79) | 4 (20.2) | 0.3 (1.7) | 1 | Carbohydrate divergence: Ref 20.2g vs DB 4g |
| **Mulberry (Shahtoot)** | ❌ **MISSING** | *None* | - | - (43) | - (9.8) | - (1.7) | 0 | Fruit not present in database |
| **Tamarind (Pulp)** | 🟠 High Div | Tamarind Rice | `OPEN_FOOD_FACTS` | 190.1 (239) | 25.4 (62.5) | 1.4 (5.1) | 1 | Carbohydrate divergence: Ref 62.5g vs DB 25.4g; Excess fat reported: Ref 0.6g vs DB 7.7g; Missing practical piece / cup serving sizes |
| **Raisins (Kishmish)** | 🔴 Critical | Brunch Sweet Raisins | `OPEN_FOOD_FACTS` | 417.9 (299) | 67 (79.2) | 4.3 (3.7) | 1 | Carbohydrate divergence: Ref 79.2g vs DB 67g; Excess fat reported: Ref 0.5g vs DB 15g; Missing practical piece / cup serving sizes |
| **Dried Fig (Sukha Anjeer)** | ❌ **MISSING** | *None* | - | - (249) | - (63.9) | - (9.8) | 0 | Fruit not present in database |
| **Dried Apricot (Jardalu)** | ❌ **MISSING** | *None* | - | - (241) | - (62.6) | - (7.3) | 0 | Fruit not present in database |
| **Tangerine / Mandarin** | 🟡 Acceptable | Mandarin Orange Segments | `OPEN_FOOD_FACTS` | 59.9 (53) | 15.6 (13.3) | 1.2 (1.8) | 1 | None (Passed) |
| **Persimmon** | ❌ **MISSING** | *None* | - | - (70) | - (18.6) | - (3.6) | 0 | Fruit not present in database |
| **Coconut Water (Fresh)** | 🟠 High Div | Swing Coconut Water | `OPEN_FOOD_FACTS` | 28.8 (19) | 7.2 (3.7) | 0 (1.1) | 1 | Missing dietary fiber (Ref: 1.1g, DB: 0g) |
| **Cranberry** | 🔴 Critical | Oatmeal With Cranberry | `OPEN_FOOD_FACTS` | 380 (46) | 62 (12) | 7.1 (3.6) | 1 | Suspicious high calorie scaling (Possible whole-piece base scaling error); Carbohydrate divergence: Ref 12g vs DB 62g; Excess fat reported: Ref 0.1g vs DB 7.7g; Missing practical piece / cup serving sizes |
| **Pomelo** | ❌ **MISSING** | *None* | - | - (38) | - (9.6) | - (1) | 0 | Fruit not present in database |

## 3. Recommended Remediation Actions

1. **Seed Missing Fruits**: Ensure all core staple & regional fruits (e.g. Amla, Jamun, Sitaphal, Mosambi) are present with primary source `IFCT_2017` or `INDB`.
2. **Populate Standard Piece Servings**: For all whole fruits, verify presence of `1 medium`, `1 small`, `1 cup sliced` in `FoodServing` table with correct weights and `ServingUnitType.COUNT` / `VOLUME`.
3. **Correct Missing Fiber**: Review foods with 0g fiber where the reference contains significant dietary fiber (e.g., Guava, Berries, Chikoo).
