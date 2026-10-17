import json
from pathlib import Path


TRANSLATIONS = {
    "ルイ！/n別動隊からの伝令は/n到着したか？": "路易！/n别动队的传令/n到了吗？",
    "はっ！/n只今到着しました。": "是！/n刚刚到了。",
    "作戦どおりに秘密通路から潜入、/n味方の捕虜を救出する。": "按计划从密道潜入，/n救出我方俘虏。",
    "戦況はどうだ？": "战况如何？",
    "下層入口付近では予定どおり、/nイザベル隊とカーナ隊が/n警備兵との交戦を始めました！": "下层入口附近按计划，/n伊莎贝尔队和卡娜队/n已与警备兵交战！",
    "敵は陽動作戦に/n気づいていません。": "敌人还没察觉/n佯动作战。",
    "よし、我々も行動を開始する。": "好，我们也开始行动。",
    "ゼフィールファルコン第１部隊！/nメディチ隊、行動開始！": "西风猎鹰第1部队！/n梅迪奇队，开始行动！",
    "難攻不落の要塞、脱獄不可能と呼ばれたインフェルノも/n遂に落ちるときが来たようだな。/n/n[メディチ]/nゼフィールファルコンの名にかけ/n無実の罪で捕まった人々を、一人でも多く救い出してやる。": "号称难攻不落、无人能逃的因菲尔诺，/n看来也终于到了陷落的时候。/n/n[梅迪奇]/n以西风猎鹰之名起誓，/n我要尽可能救出那些蒙冤被囚的人。",
    "インフェルノ監獄要塞か。": "因菲尔诺监狱要塞啊。",
    "待っていろ、同胞たちよ。/n今、助けてやる。": "等着吧，同胞们。/n我这就救你们。",
    "すべてはクラウジビッツ軍師の/n予想されたとおりです。": "一切都如克劳塞维茨军师/n预料的一样。",
    "かなり、/n混乱している模様です。": "看样子，/n相当混乱。",
    "敵が混乱した隙を突いて内部へ潜入。/n味方の捕虜を救出する。": "趁敌人混乱潜入内部。/n救出我方俘虏。",
    "[警備兵]/nうぐっ・・・！？": "[警备兵]/n呜啊……！？",
    "[警備兵]/nなっ、何者だ！？": "[警备兵]/n什、什么人！？",
    "気づくのが、遅かったな。": "发现得太晚了。",
    "[警備兵]/nお前たち・・・/nいつのまに・・・": "[警备兵]/n你们……/n什么时候……",
    "[メディチ]命までは奪わん。よし、内部へ突入するぞ。": "[梅迪奇]我不会取你性命。好，突入内部！",
    "[警備兵]/nううっ・・・": "[警备兵]/n呜呜……",
}


def main():
    rows = json.loads(Path("_work/text/story_ac_bf.json").read_text(encoding="utf-8"))
    patched = []
    missing = []
    too_long = []

    for row in rows:
        translation = TRANSLATIONS.get(row["text"])
        if not translation:
            continue
        encoded_length = len(translation.encode("gbk"))
        if encoded_length > row["byteLength"]:
            too_long.append((row["id"], row["byteLength"], encoded_length, translation))
            continue
        item = dict(row)
        item["translation"] = translation
        patched.append(item)

    found_texts = {row["text"] for row in patched}
    for text in TRANSLATIONS:
        if text not in found_texts:
            missing.append(text)

    if missing or too_long:
        for text in missing:
            print(f"MISSING: {text}")
        for row_id, capacity, length, translation in too_long:
            print(f"TOO_LONG: {row_id} {length}>{capacity} {translation}")
        raise SystemExit(1)

    out = Path("_work/text/gbk_probe_story_patch.json")
    out.write_text(json.dumps(patched, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"probe rows={len(patched)} -> {out}")


if __name__ == "__main__":
    main()
