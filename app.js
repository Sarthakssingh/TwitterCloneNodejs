const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const dbRunner = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Database has been connected and running at 3000");
    });
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

dbRunner();

//Authentication of jwt token
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "token", async (error, payLoad) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.headers.username = payLoad.username;
        next();
      }
    });
  }
};

//user following list
const isUserFollowing = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request.headers;
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;

  const dbUser = await db.get(getUserQuery);
  const userId = dbUser["user_id"];
  const followingQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${userId};`;
  const userFollowingData = await db.all(followingQuery);

  const tweetUserIdQuery = `
    SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
  const tweetData = await db.get(tweetUserIdQuery);
  const tweetUserID = tweetData["user_id"];

  let isTweetUSerIDInFollowingIds = false;
  userFollowingData.forEach((each) => {
    if (each["following_user_id"] === tweetUserID) {
      isTweetUSerIDInFollowingIds = true;
    }
  });

  if (isTweetUSerIDInFollowingIds) {
    next();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
};

// register a user api
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashPassword = await bcrypt.hash(password, 10);
  const usernameQuery = `SELECT * FROM user WHERE username = '${username}';`;

  const userExist = await db.get(usernameQuery);

  if (userExist === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      addUserQuery = `INSERT INTO user (username,password,name,gender)
      VALUES ('${username}','${hashPassword}','${name}','${gender}');`;
      const addUser = await db.run(addUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//login api
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const checkUser = await db.get(checkUserQuery);

  if (checkUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isCorrectPassword = await bcrypt.compare(
      password,
      checkUser.password
    );
    if (isCorrectPassword) {
      response.status(200);
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//get user feed
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const userId = dbUser["user_id"];

  const feedQuery = `SELECT username, tweet, date_time As dateTime
    FROM follower 
    INNER JOIN tweet
    ON follower.following_user_id = tweet.user_id
    WHERE follower.follower_user_id = ${userId}
    ORDER BY dateTime DESC
    LIMIT 4`;
  const feed = await db.all(feedQuery);
  response.send(feed);
});

// get followings..
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const userId = dbUser["user_id"];

  const followingQuery = `
    SELECT name
    FROM follower INNER JOIN user
    ON follower.following_user_id = user.user_id
    WHERE follower_user_id = ${userId};`;

  const following = await db.all(followingQuery);
  response.send(following);
});

//get followers list
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const userId = dbUser["user_id"];

  const FollowersQuery = `
    SELECT name
    FROM follower INNER JOIN user
    ON follower.follower_user_id = user.user_id
    WHERE following_user_id = ${userId};`;

  const followersList = await db.all(FollowersQuery);
  response.send(followersList);
});

//get tweet by id.
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  //   const { username } = request.headers;
  //   const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  //   const dbUser = await db.get(getUserQuery);
  //   const userId = dbUser["user_id"];

  const tweetQuery = `SELECT tweet, COUNT(reply) AS replies, date_time AS dateTime
        FROM tweet INNER JOIN reply
        ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
  const tweets = await db.get(tweetQuery);

  const likesQuery = `SELECT COUNT(like_id) AS likes
         FROM like WHERE tweet_id  = ${tweetId};`;
  const { likes } = await db.get(likesQuery);

  tweets.likes = likes;
  response.send(tweets);
});

// liking a tweet..
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const userQuery = `SELECT username
        FROM like JOIN user
        WHERE tweet_id = ${tweetId};`;

    const userData = await db.all(userQuery);
    const usernamesArray = userData.map((each) => each.username);

    response.send({ likes: usernamesArray });
  }
);

//get tweet replies...
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const replyQuery = `
        SELECT name, reply
        FROM reply JOIN user
        WHERE tweet_id = ${tweetId};`;

    const replies = await db.all(replyQuery);

    response.send({ replies: replies });
  }
);

// all tweets of user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const userId = dbUser["user_id"];

  const tweetsQuery = `
    SELECT tweet, COUNT(like_id) AS likes, date_time As dateTime
    FROM tweet INNER JOIN like
    ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`;
  let likesData = await db.all(tweetsQuery);

  const repliesQuery = `
    SELECT tweet, COUNT(reply) AS replies
    FROM tweet INNER JOIN reply
    ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`;

  const repliesData = await db.all(repliesQuery);

  likesData.forEach((each) => {
    for (let data of repliesData) {
      if (each.tweet === data.tweet) {
        each.replies = data.replies;
        break;
      }
    }
  });
  response.send(likesData);
});

//tweeting..
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const userId = dbUser["user_id"];

  const tweetQuery = `
    INSERT INTO
        tweet(tweet, user_id)
    VALUES ('${tweet}', ${userId});`;
  await db.run(tweetQuery);
  response.send("Created a Tweet");
});

//delete a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request.headers;
    const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`;
    const dbUser = await db.get(getUserQuery);
    const userId = dbUser["user_id"];

    const userTweetsQuery = `
    SELECT tweet_id, user_id
    FROM tweet
    WHERE user_id = ${userId};`;
    const userTweetsData = await db.all(userTweetsQuery);

    let isTweetUsers = false;
    userTweetsData.forEach((each) => {
      if (each["tweet_id"] == tweetId) {
        isTweetUsers = true;
      }
    });

    if (isTweetUsers) {
      const query = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId};`;
      await db.run(query);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
