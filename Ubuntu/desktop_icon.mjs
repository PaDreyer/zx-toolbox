#!/usr/bin/env zx

// show a spinner while promise is pending

function spinner(title, callback, doneMsg, finalCb) {
    let i = 0;
    const spin =
        () => process.stderr.write(`  ${'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[i++ % 10]} ${title}\r`);
    return within(async () => {
        $.verbose = false
        const id = setInterval(spin, 100)
        let result;
        try {
            result = await callback()
        } finally {
            clearInterval(id);
            if(finalCb) finalCb();
        }
        process.stderr.write(
            (formatStatus(doneMsg ?? title) +
                " ".repeat(200)).slice(0, 200)
            + "\n"
        );
        return result
    })
}

// format status message
function formatStatus(message, failed = false) {
    if(failed) {
        return "[FAIL]   " + message;
    } else {
        return "[DONE]   " + message;
    }
}

function getCommandArgs() {
    const executionArgs = process.argv;
    if(!executionArgs[2].includes(path.basename(__filename))) throw new Error("Unexpected behaviour");
    return executionArgs.slice(3);
}

const commandArgs = getCommandArgs();
if(commandArgs.length > 1) throw new Error("Only one command is supported. One of: create,");

switch(commandArgs[0]) {
    case "create":
        await create();
        break;
    default:
        throw new Error(`Command: '${commandArgs[0]}' is not implemented. One of: create,`)
}

async function create() {
    let applicationName = await question("Name of your application: ");
    if(applicationName === "") throw new Error("Application name is required");

    let applicationComment = await question("Comments for your application (FORMAT: hello;world;example): ");
    if(applicationComment === "") applicationComment=applicationName;

    // TODO use relative commands (from path)
    // check command via 'command -v <command>'
    let applicationExec = await question("Executable path: ");
    if(applicationExec === "") throw new Error("Application executable is required");
    applicationExec = path.normalize(path.join(applicationExec));
    const executableExists = fs.existsSync(applicationExec);
    if(!executableExists) throw new Error("Executable does not exists");

    // TODO save icons at ~/.icons and use relative path
    let applicationIcon = await question("Icon path: ");
    if(applicationIcon === "") {
        const ignoreIcon = await question("Icon is empty. Sure you want to continue ? (y/n): ");
        if(ignoreIcon === "") throw new Error("Decision is required");

        if(ignoreIcon === "n") throw new Error("Creation canceled");
    }

    applicationIcon = path.normalize(path.join(applicationIcon));
    const iconExists = fs.existsSync(applicationIcon);
    if(!iconExists) throw new Error("Icon does not exists");

    let terminal = await question("Run in terminal ? (y/n): ");
    if(terminal === "") throw new Error("Terminal setting is required");

    switch(terminal) {
        case "y":
            terminal = true;
            break;
        case "n":
            terminal = false;
            break;
        default:
            throw new Error("Unsupported answer for terminal");
    };

    let type = await question("Application type: ");
    if(type === "") type = applicationName;

    let applicationCategories = await question("Application categories (FORMAT: hello;world;example): ");
    if(applicationCategories === "") applicationCategories = applicationName;

    let useStartUpWmClass = await question("Should use StartupWMClass ? (y/n): ");
    switch(useStartUpWmClass) {
        case "":
            throw new Error("Answer required");
            break;
        case "n":
            useStartUpWmClass = false;
            break;
        case "y":
            useStartUpWmClass = true;
            break;
        default:
            throw new Error("Unsuppoert answer for useStartupWmClass");
            break;
    }

    let startupWmClass;
    if(useStartUpWmClass) {
        startupWmClass = await question("StartupWmClass name: ");
        if(startupWmClass === "") throw new Error("StartupWmClass is required");
    }

    let startupNotify = await question("Startup notify ? (y/n): ");
    switch(startupNotify) {
        case "":
            throw new Error("Answer is required");
            break;
        case "y":
            startupNotify = true;
            break;
        case "n":
            startupNotify = false;
            break;
        default:
            throw new Error("StartupNotify answer is required");
            break;
    }

    const template =`
    [Desktop Entry]
    Name=${applicationName}
    Comment=${applicationComment}
    Exec=${applicationExec}
    ${applicationIcon !== undefined ? `Icon=${applicationIcon}` : ""}
    Terminal=${terminal}
    Type=${type}
    Categories=${applicationCategories}
    ${useStartUpWmClass ? `StartupWMClass=${startupWmClass}` : ""}
    StartupNotify=${startupNotify}
    `

    const formattedString = template
        .split("\n")
        .map(item => item.trim())
        .filter(item => item !== "")
        .join("\n")

    await $`sudo echo ${formattedString} > /usr/share/applications/${applicationName.toLowerCase()}.desktop`
        .catch(
            e => console.log(
                formatStatus("Could not create .desktop file", true)
            )
        );

    console.log("Desktop file created!");
}
