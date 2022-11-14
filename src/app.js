import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from "joi";
import dayjs from "dayjs";

const app = express();

const participantSchema = joi.object({
  name: joi.string().required(),
});

const messagesSchema = joi.object({
  to: joi.string().required(),
  text: joi.string().required(),
  type: joi.string().required().valid("message", "private_message"),
});

dotenv.config();
app.use(cors());
app.use(express.json());
const mongoClient = new MongoClient(process.env.MONGO_URI);
await mongoClient.connect();
const db = mongoClient.db("chatUOL");
const PORT = 5000;
const INTERVAL = 15000;
const TEN_S_IN_MS = 10000;

app.post("/participants", async (req, res) => {
  try {
    const { name } = req.body;
    const exists = await db.collection("participants").findOne({ name: name });
    if (exists) {
      return res.sendStatus(409);
    }
    const { error } = participantSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.send(errors);
    }
    const time = dayjs(Date.now()).locale("pt").format("HH:mm:ss");
    await db
      .collection("participants")
      .insertOne({ name: name, lastStatus: Date.now() });
    await db.collection("messages").insertOne({
      from: name,
      to: "Todos",
      text: "entra na sala...",
      type: "status",
      time: time,
    });
    res.sendStatus(201);
  } catch (err) {
    res.sendStatus(500);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await db.collection("participants").find().toArray();
    res.send(participants);
  } catch (err) {
    res.sendStatus(500);
  }
});

app.post("/messages", async (req, res) => {
  try {
    const user = req.headers.user;
    const exists = await db.collection("participants").findOne({ name: user });
    if (!exists) {
      return res.sendStatus(422);
    }
    const { to, text, type } = req.body;
    const { error } = messagesSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(422).send(errors);
    }
    const time = dayjs(Date.now()).locale("pt").format("HH:mm:ss");
    await db
      .collection("messages")
      .insertOne({ from: user, to, text, type, time });
    res.sendStatus(201);
  } catch (err) {
    res.sendStatus(500);
  }
});

app.get("/messages", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const user = req.headers.user;
    const exists = await db.collection("participants").findOne({ name: user });
    if (!exists) {
      return res.sendStatus(422);
    }
    const messages = await db
      .collection("messages")
      .find({
        $or: [
          { from: user },
          { to: user },
          { type: "message" },
          { to: "Todos" },
        ],
      })
      .sort({ time: 1 })
      .limit(limit)
      .toArray();
    res.send(messages);
  } catch (err) {
    res.sendStatus(500);
  }
});

app.post("/status", async (req, res) => {
  try {
    const user = req.headers.user;
    const exists = await db.collection("participants").findOne({ name: user });
    if (!exists) {
      return res.sendStatus(404);
    }
    await db
      .collection("participants")
      .updateOne({ _id: exists._id }, { $set: { lastStatus: Date.now() } });
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(500);
  }
});

async function deleteInactives() {
  const inactives = await db
    .collection("participants")
    .find({ lastStatus: { $lt: Date.now() - TEN_S_IN_MS } })
    .toArray();
  inactives.forEach((inactive) => {
    const { name } = inactive;
    const time = dayjs(Date.now()).locale("pt").format("HH:mm:ss");
    db.collection("participants").deleteOne({ _id: ObjectId(inactive._id) });
    db.collection("messages").insertOne({
      from: name,
      to: "Todos",
      text: "sai da sala...",
      type: "status",
      time,
    });
  });
}

const deleteInactivesID = setInterval(deleteInactives, INTERVAL);

app.listen(PORT);
