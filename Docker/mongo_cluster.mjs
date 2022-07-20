#!/usr/bin/env zx
import { spawn } from 'child_process';

$.verbose = false;

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

async function errorHandler(message, fatal = false) {
    console.log(
        formatStatus(message, true)
    )

    if(fatal) {
        const commands = commandsToUndo.reverse();
        for(var command = 0; command < commands.length; ++command) {
            console.log("command: ", commands[command]);
            const executable = commands[command].substr(0, commands[command].indexOf(" "));
            const args = commands[command].substr(commands[command].indexOf(" ")+1).split(" ");
            await $`${executable} ${args}`
        }
        process.exit(1);
    }
}

let mongoVersion = await question("MongoDB version ? (DEFAULT:5.0.3)");
if(mongoVersion === "") mongoVersion = "5.0.3";

const mongoImage = `mongo:${mongoVersion}`;

let adminUser = await question("Admin user ? (DEFAULT:admin)");
if(adminUser === "") adminUser = "admin";

let adminPassword = await question("Admin password ? (DEFAULT:admin)");
if(adminPassword === "") adminPassword = "admin";

let mongoNetworkName = await question("Docker network name ? (DEFAULT:mongo-cluster)");
if(mongoNetworkName === "") mongoNetworkName = "mongo-cluster";

let mongoStartPort = parseInt(await question("Port to start with ? (DEFAULT:27017)"));
if(typeof mongoStartPort !== "number" || mongoStartPort === "" || isNaN(mongoStartPort)) mongoStartPort = 27017;

let numberOfWorker = parseInt(await question("Number of workers? (DEFAULT:3)"))
if(typeof numberOfWorker !== "number" || numberOfWorker === "" || isNaN(numberOfWorker)) numberOfWorker = 3;

let replSetName = await question("ReplicaSet name ? (DEFAULT: rs0)");
if(replSetName === "") replSetName = "rs0";

let mongoDataDir = await question("Which absolute directory should be used for your data ? (DEFAULT: /home/$USER/.containers/mongo-cluster/)");
if(mongoDataDir === "") mongoDataDir = path.normalize(path.join(os.homedir(), ".containers/mongo-cluster"));
const workerDataDirName = "mongo";

const commandsToUndo = [];

await spinner(
    "Creating directory...",
    () => $`mkdir -p ${path.normalize(mongoDataDir)}`,
    "Directory created",
    () => commandsToUndo.push(`rmdir ${path.normalize(mongoDataDir)}`)
).catch(
    e => errorHandler("Cannot create directory", true)
);

const keyFilePath = path.normalize(path.join(mongoDataDir, "keyfile.key"));

await spinner(
    "Creating key file...",
    () =>  $`sudo openssl rand -base64 756 > ${keyFilePath}`,
    "Key file created",
    () => commandsToUndo.push(`rm ${keyFilePath}`)
).catch(
    e => errorHandler("Key already exists", false)
);

await $`sudo chmod 0400 ${keyFilePath}`;
await $`sudo chown 999 ${keyFilePath}`;

await spinner(
    "Pulling docker image...",
    () => $`sudo docker pull ${mongoImage}`,
    "Docker image pulled",
    () => commandsToUndo.push(`docker image rm ${mongoImage}`)
).catch(
    e => errorHandler("Repository not reachable", false)
);

await spinner(
    "Creating docker network...",
    () => $`sudo docker network create ${mongoNetworkName}`,
    "Docker network created",
    () => commandsToUndo.push(`docker network rm ${mongoNetworkName}`)
).catch(
    e => errorHandler("Docker network already exists", false)
);

let mongoConfig = {
    _id: replSetName,
    members: []
}

let dockerNames = [];
for (let workerNumber = 1; workerNumber <= numberOfWorker; ++workerNumber) {
    const workerPathDir = path.normalize(path.join(mongoDataDir, `${workerDataDirName}-${workerNumber}`))
    const workerPort = mongoStartPort + workerNumber - 1;
    const workerName = "" + workerDataDirName + "-" + workerNumber;
    await spinner(
        `Creating worker-${workerNumber} of ${numberOfWorker}`,
        async() => {
            dockerNames.push(workerName);
            await $`mkdir -p ${workerPathDir}`;
            mongoConfig.members.push({
                "_id": workerNumber-1,
                "host": `${workerDataDirName}-${workerNumber}:${workerPort}`,
                "priority": numberOfWorker - workerNumber + 1,
            });
            await $`sudo docker run -d --net ${mongoNetworkName} -p ${workerPort}:${workerPort} --restart always --name ${workerName} -v ${workerPathDir}:/data/db ${mongoImage} mongod --replSet ${replSetName} --port ${workerPort} --bind_ip 0.0.0.0`;
        },
        `Successfully created worker-${workerNumber}`,
        () => commandsToUndo.push(`docker container rm ${workerName}`, `docker container stop ${workerName}`),
    ).catch(
        e => errorHandler(`Creating worker-${workerNumber} failed`, true)
    );
}

await spinner(
    "Waiting for containers to get started....",
    async() => {
        while(true) {
            const result = (await $`docker container ls --format='{{json .Names}}'`).toString();
            if(result && result !== "") {
                const stdout = result.replaceAll('"', "").split("\n").filter(item => item !== "");
                if(dockerNames.every( name => stdout.includes(name))) break;
            }
            await sleep(1000);
        }
    },
    "All container started"
).catch(
    e => errorHandler("Could not determine if all container are up", true)
);

const userConfig = {
    user: adminUser,
    pwd: adminPassword,
    roles: [
        { role: 'root', db: 'admin' }
    ]
}

const js = `test = new Mongo('localhost:${mongoStartPort}');\n test.getDB('test');\nconfig=${JSON.stringify(mongoConfig)};\nrs.initiate(config);\n`
fs.writeFileSync("./script.js", js);

await spinner(
    "Copying replica config files to container and setup...",
    async() => {
        await $`docker cp ./script.js ${dockerNames[0]}:/setup.js`;
        await $`docker exec ${dockerNames[0]} mongosh -f /setup.js`;
    },
    "Replica config copied and applied"
).catch(
    e => errorHandler("Could not apply replica config", true)
);

fs.rmSync("./script.js");

await spinner(
    "Waiting for first container to get primary....",
    async() => {
        while(true) {
            const result = (await $` docker exec ${dockerNames[0]} /bin/bash -c '/usr/bin/mongosh --eval "rs.isMaster()"'`).toString();
            if(result.includes("ismaster: true")) break;
            await sleep(1000);
        }
    },
    "First container successfully got primary"
).catch(
    e => errorHandler("Could not determine if first container got primary", true)
);

fs.writeFileSync("./script.js", `user=${JSON.stringify(userConfig)};db.createUser(user);`);
await spinner(
    "Copying user config files to container and setup...",
    async() => {
        await $`docker cp ./script.js ${dockerNames[0]}:/setup.js`;
        await $`docker exec ${dockerNames[0]} mongosh admin -f /setup.js`;
    },
    "User config copied and applied"
).catch(
    e => errorHandler("Could not apply user config", true)
);

fs.rmSync("./script.js");

console.log("Everything set up. Have fun!");
