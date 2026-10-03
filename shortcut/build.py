"""
Builds the iPhone Shortcut "Планер" (unsigned plist) — sign with:
  shortcuts sign --mode anyone --input shortcut/Планер.unsigned.shortcut --output public/planner.shortcut

Actions:
  1. Dictate text (Russian, stops after a pause)
  2. POST {"text": <dictated text>} to the user's personal link
  3. Answer understood → a compact result banner ("Готово ✅ …"), no notification.
     Needs details → a menu with "Открыть планер" (opens the Mini App on the assistant) / "Позже".
On import the user is asked once for their personal link (Assistant → «Кнопка на iPhone»).
"""
import plistlib, uuid, pathlib

DICTATE = str(uuid.uuid4()).upper()
POST = str(uuid.uuid4()).upper()
IF_GROUP = str(uuid.uuid4()).upper()
MENU_GROUP = str(uuid.uuid4()).upper()
URL_UUID = str(uuid.uuid4()).upper()
# Opens the Mini App straight on the assistant (start_param "a").
PLANNER_LINK = "https://t.me/myliveplaners_bot?startapp=a"

def text_token(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

def answer_input():
    """The server's answer as the subject of the "If" condition."""
    return {
        "Type": "Variable",
        "Variable": {
            "Value": {"OutputUUID": POST, "Type": "ActionOutput", "OutputName": "Содержимое URL"},
            "WFSerializationType": "WFTextTokenAttachment",
        },
    }

def answer_token():
    """The server's answer ("Готово ✅ …" / "Нужно уточнение …") as a text variable."""
    return {
        "Value": {
            "string": "\ufffc",
            "attachmentsByRange": {"{0, 1}": {"OutputUUID": POST, "Type": "ActionOutput", "OutputName": "Содержимое URL"}},
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
        # If the assistant needs details → a menu with "Открыть планер"; otherwise a result banner.
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": IF_GROUP,
                "WFControlFlowMode": 0,
                # Legacy single-condition keys (older iOS) …
                "WFCondition": 99,  # "contains"
                "WFConditionalActionString": "уточнение",
                "WFInput": answer_input(),
                # … and the current condition-table format (iOS 17+), same condition.
                "WFConditions": {
                    "Value": {
                        "WFActionParameterFilterPrefix": 1,
                        "WFActionParameterFilterTemplates": [
                            {"WFCondition": 99, "WFConditionalActionString": "уточнение", "WFInput": answer_input()}
                        ],
                    },
                    "WFSerializationType": "WFContentPredicateTableTemplate",
                },
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": MENU_GROUP,
                "WFControlFlowMode": 0,
                "WFMenuPrompt": answer_token(),
                "WFMenuItems": ["Открыть планер", "Позже"],
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {"GroupingIdentifier": MENU_GROUP, "WFControlFlowMode": 1, "WFMenuItemTitle": "Открыть планер"},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.url",
            "WFWorkflowActionParameters": {"UUID": URL_UUID, "WFURLActionURL": PLANNER_LINK},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
            "WFWorkflowActionParameters": {
                "WFInput": {
                    "Value": {"OutputUUID": URL_UUID, "Type": "ActionOutput", "OutputName": "URL"},
                    "WFSerializationType": "WFTextTokenAttachment",
                },
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {"GroupingIdentifier": MENU_GROUP, "WFControlFlowMode": 1, "WFMenuItemTitle": "Позже"},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {"GroupingIdentifier": MENU_GROUP, "WFControlFlowMode": 2},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {"GroupingIdentifier": IF_GROUP, "WFControlFlowMode": 1},
        },
        {
            # "Show Result": a compact banner on top of the screen, no notification.
            "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
            "WFWorkflowActionParameters": {"UUID": str(uuid.uuid4()).upper(), "Text": answer_token()},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {"GroupingIdentifier": IF_GROUP, "WFControlFlowMode": 2},
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
