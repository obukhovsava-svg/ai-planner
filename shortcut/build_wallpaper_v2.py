"""
Builds the iPhone Shortcut "Обои ПЛАН" for Telegram users, v2: nothing to paste on install.
  shortcuts sign --mode anyone --input "shortcut/Обои ПЛАН v2.unsigned.shortcut" --output "shortcut/Обои ПЛАН.shortcut"

The planner's «Подключить» button opens public/connect.html, which runs this Shortcut with the
personal wallpaper link as input (shortcuts://run-shortcut?…&input=text). Then:
  1. Input given → it's the link: saved to «Команды»' iCloud folder (plan-wallpaper-link.txt)
  2. Read the saved link (not there yet → a hint where to press «Подключить», stop)
  3. GET today's wallpaper by the link
  4. Set it as the Lock Screen wallpaper, no preview
Runs without input from the «Telegram closed» automation.
"""
import plistlib, uuid, pathlib

FILE = "plan-wallpaper-link.txt"
u = lambda: str(uuid.uuid4()).upper()
IF1, IF2 = u(), u()
OPEN, TEXT, GET = u(), u(), u()

shortcut_input = {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}


def output(uuid_, name):
    return {"Value": {"OutputUUID": uuid_, "Type": "ActionOutput", "OutputName": name}, "WFSerializationType": "WFTextTokenAttachment"}


def text_with(uuid_, name):
    return {
        "Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"OutputUUID": uuid_, "Type": "ActionOutput", "OutputName": name}}},
        "WFSerializationType": "WFTextTokenString",
    }


def action(ident, **params):
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{ident}", "WFWorkflowActionParameters": params}


actions = [
    # 1. the link handed over by «Подключить» → remember it
    action("conditional", GroupingIdentifier=IF1, WFControlFlowMode=0, WFCondition=100,
           WFInput={"Type": "Variable", "Variable": shortcut_input}),
    action("documentpicker.save", UUID=u(), WFInput=shortcut_input, WFAskWhereToSave=False,
           WFFileDestinationPath=FILE, WFSaveFileOverwrite=True),
    action("conditional", GroupingIdentifier=IF1, WFControlFlowMode=2, UUID=u()),
    # 2. read it back
    action("documentpicker.open", UUID=OPEN, WFGetFilePath=FILE, WFFileErrorIfNotFound=False, WFShowFilePicker=False),
    action("conditional", GroupingIdentifier=IF2, WFControlFlowMode=0, WFCondition=101,
           WFInput={"Type": "Variable", "Variable": output(OPEN, "Файл")}),
    action("showresult", UUID=u(), Text="Сначала подключите обои: планер в Telegram → Настройки → «Обои экрана блокировки» → «Подключить»."),
    action("exit", UUID=u()),
    action("conditional", GroupingIdentifier=IF2, WFControlFlowMode=2, UUID=u()),
    action("detect.text", UUID=TEXT, WFInput=output(OPEN, "Файл")),
    # 3–4. today's picture → Lock Screen
    action("downloadurl", UUID=GET, WFURL=text_with(TEXT, "Текст"), WFHTTPMethod="GET", ShowHeaders=False),
    action("wallpaper.set", UUID=u(), WFInput=output(GET, "Содержимое URL"), WFWallpaperLocation="Lock Screen",
           WFWallpaperShowPreview=False, WFWallpaperSmartCrop=False, WFWallpaperLegibilityBlur=False,
           WFWallpaperPerspectiveZoom=False),
]

workflow = {
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 1440408063, "WFWorkflowIconGlyphNumber": 59784},
    "WFWorkflowTypes": [],
    "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFURLContentItem"],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFQuickActionSurfaces": [],
    "WFWorkflowActions": actions,
    "WFWorkflowImportQuestions": [],
}

out = pathlib.Path(__file__).with_name("Обои ПЛАН v2.unsigned.shortcut")
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(out)
