"""
Builds the iPhone Shortcut "Планер" (unsigned plist) — sign with:
  shortcuts sign --mode anyone --input shortcut/Планер.unsigned.shortcut --output public/planner.shortcut

Actions:
  1. Dictate text (Russian, stops after a pause)
  2. POST {"text": <dictated text>} to the user's personal link
  3. Sure → a compact result banner ("Готово ✅ …"), no notification.
     Guessed something ("… Всё верно?") → a menu «Готово» / «Отмена»; «Отмена» POSTs {"undo": true}
     and the server rolls the request back.
On import the user is asked once for their personal link (Assistant → «Кнопка на iPhone»).
"""
import plistlib, uuid, pathlib

DICTATE = str(uuid.uuid4()).upper()
POST = str(uuid.uuid4()).upper()
IF_GROUP = str(uuid.uuid4()).upper()
MENU_GROUP = str(uuid.uuid4()).upper()
LINK_UUID = str(uuid.uuid4()).upper()
UNDO_UUID = str(uuid.uuid4()).upper()
TEXT_UUID = str(uuid.uuid4()).upper()

def link_token():
    """The personal link (from the first "URL" action)."""
    return {
        "Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": {"OutputUUID": LINK_UUID, "Type": "ActionOutput", "OutputName": "URL"}}},
        "WFSerializationType": "WFTextTokenString",
    }

def post(uuid_, value):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": uuid_,
            "WFURL": link_token(),
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "ShowHeaders": False,
            "WFJSONValues": {
                "Value": {"WFDictionaryFieldValueItems": [value]},
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }

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
        # 0: the personal link (asked once on import)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.url",
            "WFWorkflowActionParameters": {"UUID": LINK_UUID, "WFURLActionURL": ""},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.dictatetext",
            "WFWorkflowActionParameters": {
                "UUID": DICTATE,
                "WFSpeechLanguage": "ru-RU",
                "WFDictateTextStopListening": "After Pause",
            },
        },
        post(POST, {"WFItemType": 0, "WFKey": text_token("text"), "WFValue": dictated}),
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
        # A guess ("… Всё верно?") → menu «Готово» / «Отмена»; otherwise a result banner.
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": IF_GROUP,
                "WFControlFlowMode": 0,
                # Legacy single-condition keys (older iOS) …
                "WFCondition": 99,  # "contains"
                "WFConditionalActionString": "верно",
                "WFInput": answer_input(),
                # … and the current condition-table format (iOS 17+), same condition.
                "WFConditions": {
                    "Value": {
                        "WFActionParameterFilterPrefix": 1,
                        "WFActionParameterFilterTemplates": [
                            {"WFCondition": 99, "WFConditionalActionString": "верно", "WFInput": answer_input()}
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
                "WFMenuItems": ["Готово", "Отмена"],
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {"GroupingIdentifier": MENU_GROUP, "WFControlFlowMode": 1, "WFMenuItemTitle": "Готово"},
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.choosefrommenu",
            "WFWorkflowActionParameters": {"GroupingIdentifier": MENU_GROUP, "WFControlFlowMode": 1, "WFMenuItemTitle": "Отмена"},
        },
        post(UNDO_UUID, {"WFItemType": 0, "WFKey": text_token("undo"), "WFValue": text_token("true")}),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
            "WFWorkflowActionParameters": {
                "UUID": str(uuid.uuid4()).upper(),
                "Text": {
                    "Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": {"OutputUUID": UNDO_UUID, "Type": "ActionOutput", "OutputName": "Содержимое URL"}}},
                    "WFSerializationType": "WFTextTokenString",
                },
            },
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
            "ActionIndex": 0,
            "Category": "Parameter",
            "ParameterKey": "WFURLActionURL",
            "DefaultValue": "",
            "Text": "Вставьте вашу личную ссылку из планера (Ассистент → «Кнопка на iPhone» → «Скопировать»)",
        }
    ],
}

out = pathlib.Path(__file__).with_name("Планер.unsigned.shortcut")
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(out)
