#!/usr/bin/env zx
import { spawn } from 'child_process';
import { Duplex, Transform } from 'stream';

$.verbose = false;

function spinner(title, callback) {
    let i = 0; Stream.create
    let shouldSpin = true;
    const channel = new Duplex();
    const channel = new Transform()
    channel._transform = function(
                chunk, //: Buffer | string,
                encoding, //: string,
                callback //(error: data?: Buffer | string) => void
        ) {
        callback(null, chunk);
    }

    const spin = () => process.stderr.write(`  ${'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[i++ % 10]} ${title}\r`);

    return within(async () => {
        $.verbose = false
        const id = setInterval(spin, 100)
        let result;
        try {
            result = await callback()
        } finally {
            clearInterval(id);
            process.stdout.write(title + "\n");
        }
        return result
    })
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

await spinner("Creating directory...", async() => $`mkdir -p ${path.normalize(mongoDataDir)}`);

const keyFilePath = path.normalize(path.join(mongoDataDir, "keyfile.key"));
await $`sudo openssl rand -base64 756 > ${keyFilePath}`.catch(e => console.log(e));
await $`sudo chmod 0400 ${keyFilePath}`;
await $`sudo chown 999 ${keyFilePath}`;

await $`sudo docker pull ${mongoImage}`;
await $`sudo docker network create ${mongoNetworkName}`.catch(e => console.log("DockerNetwork already exists."))

let mongoConfig = {
    _id: replSetName,
    members: []
}
let dockerNames = [];

spinner("Creating containers.....", async () => {
    for (let workerNumber = 1; workerNumber <= numberOfWorker; ++workerNumber) {
        const workerPathDir = path.normalize(path.join(mongoDataDir, `${workerDataDirName}-${workerNumber}`))
        const workerPort = mongoStartPort+workerNumber-1;
        const workerName = "" + workerDataDirName + "-" + workerNumber;
        dockerNames.push(workerName);
        await $`mkdir -p ${workerPathDir}`;
        mongoConfig.members.push({
            "_id": workerNumber-1,
            "host": `${workerDataDirName}-${workerNumber}:${workerPort}`,
            "priority": numberOfWorker - workerNumber + 1,
        })
        await $`sudo docker run -d --net ${mongoNetworkName} -p ${workerPort}:${workerPort} --restart always --name ${workerName} -v ${workerPathDir}:/data/db ${mongoImage} mongod --replSet ${replSetName} --port ${workerPort} --bind_ip 0.0.0.0`
    }
})

await spinner("Waiting for containers to get started....", () => sleep(5000));

const userConfig = {
    user: adminUser,
    pwd: adminPassword,
    roles: [
        { role: 'root', db: 'admin' }
    ]
}
const js = `test = new Mongo('localhost:${mongoStartPort}');\n test.getDB('test');\nconfig=${JSON.stringify(mongoConfig)};\nrs.initiate(config);\n`
fs.writeFileSync("./script.js", js);
await spinner("Copying replica config files to container and setup...", async() => {
    await $`docker cp ./script.js ${dockerNames[0]}:/setup.js`;
    await $`docker exec ${dockerNames[0]} mongosh -f /setup.js`;
})
fs.rmSync("./script.js");

// await $`docker cp ./script.js ${dockerNames[0]}:/setup.js`;
// await $`docker exec ${dockerNames[0]} mongosh -f /setup.js`;

await spinner("Waiting for first container to get primary....", () => sleep(25000));

fs.writeFileSync("./script.js", `user=${JSON.stringify(userConfig)};db.createUser(user);`);
await spinner("Copying user config files to container and setup...",  async() => {
    await $`docker cp ./script.js ${dockerNames[0]}:/setup.js`;
    await $`docker exec ${dockerNames[0]} mongosh -f /setup.js`;
})
fs.rmSync("./script.js");

console.log("Everything set up. Have fun!");