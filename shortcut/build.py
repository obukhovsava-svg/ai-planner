"""
Builds the iPhone Shortcut "Планер" (unsigned plist) — sign with:
  shortcuts sign --mode anyone --input shortcut/Планер.unsigned.shortcut --output public/planner.shortcut

Actions:
  1. Dictate text (Russian, stops after a pause)
  2. POST {"text": <dictated text>} to the user's personal link
  3. Show a notification with the assistant's answer ("Готово ✅ …").
On import the user is asked once for their personal link (Assistant → «Кнопка на iPhone»).
"""
import plistlib, uuid, pathlib

DICTATE = str(uuid.uuid4()).upper()
POST = str(uuid.uuid4()).upper()

def text_token(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

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
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
            "WFWorkflowActionParameters": {
                "UUID": str(uuid.uuid4()).upper(),
                "WFNotificationActionTitle": "Планер",
                "WFNotificationActionSound": True,
                "WFNotificationActionBody": {
                    "Value": {
                        "string": "\ufffc",
                        "attachmentsByRange": {"{0, 1}": {"OutputUUID": POST, "Type": "ActionOutput", "OutputName": "Содержимое URL"}},
                    },
                    "WFSerializationType": "WFTextTokenString",
                },
            },
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
