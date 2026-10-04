"""
Builds the iPhone Shortcut "Планер" (unsigned plist) — sign with:
  shortcuts sign --mode anyone --input shortcut/Планер.unsigned.shortcut --output public/planner.shortcut

Actions:
  1. Dictate text (Russian, stops after a pause)
  2. POST {"text": <dictated text>} to the user's personal link
  3. The answer as a compact banner ("Готово ✅ …" / "Нужно уточнение — вопрос ждёт в ассистенте."),
     no notification and no buttons. Questions wait in the planner's assistant until answered.
On import the user is asked once for their personal link (Assistant → «Кнопка на iPhone»).
"""
import plistlib, uuid, pathlib

DICTATE = str(uuid.uuid4()).upper()
POST = str(uuid.uuid4()).upper()
IF_GROUP = str(uuid.uuid4()).upper()
MENU_GROUP = str(uuid.uuid4()).upper()
URL_UUID = str(uuid.uuid4()).upper()
TEXT_UUID = str(uuid.uuid4()).upper()
# Opens the Mini App straight on the assistant (start_param "a").
PLANNER_LINK = "https://t.me/myliveplaners_bot?startapp=a"

def text_token(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

AS_TEXT = [{"Type": "WFCoercionVariableAggrandizement", "CoercionItemClass": "WFStringContentItem"}]

def answer_input():
    """The server's answer (as Text) as the subject of the "If" condition."""
    return {
        "Type": "Variable",
        "Variable": {
            "Value": {"OutputUUID": TEXT_UUID, "Type": "ActionOutput", "OutputName": "Текст", "Aggrandizements": AS_TEXT},
            "WFSerializationType": "WFTextTokenAttachment",
        },
    }

def answer_token():
    """The server's answer ("Готово ✅ …" / "Нужно уточнение …") as a text variable."""
    return {
        "Value": {
            "string": "\ufffc",
            "attachmentsByRange": {"{0, 1}": {"OutputUUID": TEXT_UUID, "Type": "ActionOutput", "OutputName": "Текст"}},
        },
        "WFSerializationType": "WFTextTokenString",
    }

dictated = {
    "Value": {
        "string": "￼",
        "attachmentsByRange": {"{0, 1}": {"OutputUUID": DICTATE, "Type": "ActionOutput", "OutputName": "Продиктованный текст"}},
    },
    "WFSerializationType": "WFTextTokenString",
}

workflow = {
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 1440408063, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": ["Watch"],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": False,
    "WFQuickActionSurfaces": [],
    "WFWorkflowActions": [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.dictatetext",
            "WFWorkflowActionParameters": {
                "UUID": DICTATE,
                "WFSpeechLanguage": "ru-RU",
                "WFDictateTextStopListening": "After Pause",
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": POST,
                "WFURL": "https://ai-planner-brain.savelyobuhov.workers.dev/shortcut?key=ВСТАВЬТЕ_СВОЮ_ССЫЛКУ",
                "WFHTTPMethod": "POST",
                "WFHTTPBodyType": "JSON",
                "ShowHeaders": False,
                "WFJSONValues": {
                    "Value": {
                        "WFDictionaryFieldValueItems": [
                            {"WFItemType": 0, "WFKey": text_token("text"), "WFValue": dictated}
                        ]
                    },
                    "WFSerializationType": "WFDictionaryFieldValue",
                },
            },
        },
        # The answer as plain TEXT — otherwise "If" only offers "has any value / has no value".
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.text",
            "WFWorkflowActionParameters": {
                "UUID": TEXT_UUID,
                "WFInput": {
                    "Value": {"OutputUUID": POST, "Type": "ActionOutput", "OutputName": "Содержимое URL"},
                    "WFSerializationType": "WFTextTokenAttachment",
                },
            },
        },
        {
            # "Show Result": a compact banner on top of the screen, no notification.
            "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
            "WFWorkflowActionParameters": {"UUID": str(uuid.uuid4()).upper(), "Text": answer_token()},
        },
    ],
    "WFWorkflowImportQuestions": [
        {
            "ActionIndex": 1,
            "Category": "Parameter",
            "ParameterKey": "WFURL",
            "DefaultValue": "",
            "Text": "Вставьте вашу личную ссылку из планера (Ассистент → «Кнопка на iPhone» → «Скопировать»)",
        }
    ],
}

out = pathlib.Path(__file__).with_name("Планер.unsigned.shortcut")
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(out)
