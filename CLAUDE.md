# いろまぜラボ(iromaze-lab)

同じ2色(または3色)を「RGB直線補間」「Oklab」「絵の具式」の3通りで混ぜて並べ、RGBだと補色の中間が灰色に濁る理由を目で比べるおもちゃ。

- 公開: https://iromaze-lab.vercel.app (hub登録済み・tags: shape)
- 着想: ひきだし C区分 x:2109512644965105802(RGB立方体の中心=灰色を通るから濁る/3色目で外側を通す)、x:2109594988195778951(LAB/Oklabで混ぜる)
- 状態: M0(2026-10-21)

## スタック
素のHTML + ESモジュール。ビルド無し。Vercelは静的配信(Framework: Other)。
- `index.html` / `style.css` / `app.js`(UI・帯・3D図)/ `color.js`(変換と3方式の混色。Nodeの検算でも同じものを使う)
- `vendor/spectral.js` = spectral.js 3.0.0(MIT, Ronald van Wijnen)。UMD。`vendor/package.json` で CommonJS 扱いにしている(ルートが `type: module` のため)

## 3方式の定義
- **RGB直線**: sRGB(ガンマ付き)の数値をそのまま線形補間。CSS・お絵かきソフトの既定と同じ。補色の中間は (128,128,128)。
- **Oklab**: Ottosson 2020 の行列で sRGB→Oklab、線形補間、戻して線形RGBでクランプ。
- **絵の具式**: spectral.js の `mix`。sRGB→線形RGB→7本の基底分光(W/C/M/Y/R/G/B, 38バンド)の和で反射率→単一定数Kubelka-Munk(K/S=(1-R)²/2R を濃度で平均→R=1+KS-√(KS²+2KS))→D65×CIE1931で XYZ→sRGB。濃度は spectral.js 既定どおり「係数²×着色力²×輝度」(暗い色ほど効きが弱い)。
- **採用理由**: mixbox は非商用ライセンス(CC BY-NC)なので不採用。spectral.js は MIT で、基底分光+KM という依頼どおりの方式、青+黄が緑になる(検算5)。自前で基底分光を導出するよりデータの出典が明確。
- 3色モードは A→C→B の折れ線(t<0.5 で A→C、以降 C→B)。真ん中=C になるので「最小C」も出す。
- 3色目は既定で自動(`autoThird(a,b,arc)`): Oklch で L・C=両端の平均、色相=近回り(近い側の弧の中間)/遠回り(反対側)。片方が無彩色ならもう一方の色相(遠はその反対色)、両方無彩色なら暖色/寒色。sRGBに収まるまでCだけ下げる。AやBを変えると追従、Cを手で選ぶと手動。URLは `c=auto`(近)/`c=far`(遠)。
- 開いた直後は3色モード(青×黄+近回り)。プリセットは全23ペアに「2色/近回り/遠回り」の3チップ
- 帯は方式ごとに上=中間色なし(A→B)/下=中間色あり(A→C→B)の2段(チェックを外すと上だけ)。3D図は3色モードのとき「なし」の経路を薄く重ねる。
- 表示する C は Oklch の彩度(クランプ後の色で計算)。真ん中C・最小C(帯でいちばん濁った所)と、% = 最小C ÷ 両はしのCの平均。

## Build, Test & Verify
- `npm run dev` → http://localhost:5193(`scripts/serve.mjs`、依存なし)
- `npm run check` → 物理の検算(白+白=白/同色どうし=その色/端点/補色の中間でRGBの彩度が落ちる/絵の具式で青+黄=緑/Oklab往復)。NGで exit 1
- `node Z:/Claude/_tools/smoke.mjs --app iromaze-lab "http://localhost:5193/#a=0000ff&b=ffff00&c=auto"`(URLハッシュで色を固定。c無しだと「あり」段が非表示=未描画でblank判定になる)
- デプロイ: GitHub acglay/iromaze-lab に push → Vercel 自動デプロイ

## 残課題(M0の外)
- 混ぜる比率のスライダー(今は帯全体で見せるだけ)、絵の具の着色力(tintingStrength)調整
- 線形RGB補間を4本目として出すか(物理的な光の足し算)
- 3D図はCanvas 2Dの簡易投影。奥行きの前後関係は描き分けていない
