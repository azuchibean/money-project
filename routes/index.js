require('dotenv').config();
var express = require('express');
var router = express.Router();
const axios = require('axios');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
var { fetchExchangeRate, fetchLastSevenDays } = require('../db');
const QuickChart = require('quickchart-js');


AWS.config.update({
  region: 'us-west-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const ses = new AWS.SES({ apiVersion: '2010-12-01' });

const poolData = {
  UserPoolId: process.env.COGNITO_USER_POOL_ID,
  ClientId: process.env.COGNITO_APP_CLIENT_ID
};

const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

//autheneticates user based on their accesstoken given on cognito login 
function requireAuth(req, res, next) {
  try {
    const accessToken = req.session.user.accessToken;
    //validate accessToken expiry
    const decodedToken = jwt.decode(accessToken);
    const currentTime = Math.floor(Date.now() / 1000);

    if (!decodedToken || !decodedToken.exp || decodedToken.exp < currentTime) {
      console.log("Access token is invalid or expired");
      return res.redirect('/login');
    }

    // Calculate remaining time until token expiration
    const remainingTime = decodedToken.exp - currentTime;
    console.log("Access token expires in:", remainingTime, "seconds");

    // Token is valid, continue with your logic
    next();
  } catch (e) {
    console.log("Access token is missing please login");
    return res.redirect('/login');
  }

}


/* GET home page. */
router.get('/', async (req, res, next) => {
  try {
    // Render the index page with the retrieved data
    res.render('index');
  } catch (error) {
    // Handle errors
    console.error(error);
    res.status(500).send('Error fetching data');
  }
});

/* get main page*/
router.get('/main', requireAuth, function (req, res, next) {
  const filePath = path.join(__dirname, '..', 'public', 'currencies.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.render('main', { currencies: data.currencies });
});

router.get('/converter', requireAuth, function (req, res) {
  const filePath = path.join(__dirname, '..', 'public', 'currencies.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.render('converter', { currencies: data.currencies });
})


/* get sign up page */
router.get('/signup', (req, res) => {
  res.render('signup');
});

router.post('/signup', (req, res) => {
  const { email, password } = req.body; // Get email and password from the form

  const attributeList = [
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'email', Value: email })
  ];

  userPool.signUp(email, password, attributeList, null, (err, result) => {
    if (err) {
      console.error('Signup error:', err);
      let errorMessage = err.message;

      // Check if the error is because the user already exists
      if (err.code === 'UsernameExistsException') {
        errorMessage = 'User already exists. Please use a different email or login.';
      }
      res.status(400).render('signup', { errorMessage: err.message });
      return;
    }
    console.log('Signup success:', result);
    req.session.email = email; // Store email in session
    res.redirect('/confirm'); // Redirect to the confirmation page
  });
});



/* get login page */
router.get('/login', (req, res) => {
  const message = req.query.message;
  res.render('login', {message: message});
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
    Username: username,
    Password: password
  });

  const userData = {
    Username: username,
    Pool: userPool
  };

  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

  cognitoUser.authenticateUser(authenticationDetails, {
    onSuccess: (result) => {
      console.log('Login successful');
      req.session.user = {
        accessToken: result.getAccessToken().getJwtToken(),
        email: username
      }
      res.redirect('/main'); // Redirect to home page
    },
    onFailure: (err) => {
      if (err.code === 'UserNotConfirmedException') {
        // Redirect to the confirmation page with the username pre-filled
        res.render('confirm', { email: username, errorMessage: 'Account not confirmed. Please enter the verification code sent to your email.' });
      } else if (err.code === 'NotAuthorizedException') {
        // Handle incorrect email or password
        res.render('login', { errorMessage: 'Email or password is incorrect.', message:''});
      } else {
        // Handle other errors
        console.error(err);
        res.render('login', { errorMessage: 'Login failed. Please try again.', message:'' });
      }
    }
  });
});


/* get email verification page */
router.get('/confirm', (req, res) => {
  const email = req.session.email; // Retrieve email from session
  res.render('confirm', { email: email });
});

router.post('/confirm', (req, res) => {
  const { username, code } = req.body; // Username is now passed as a hidden field

  const userData = {
    Username: username,
    Pool: userPool
  };

  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

  cognitoUser.confirmRegistration(code, true, (err, result) => {
    if (err) {
      console.error(err);
      res.status(400).render('confirm', { email: username, errorMessage: err.message });
      return;
    }
    console.log('Account confirmed:', result);
    res.redirect('/login?message=Account successfully created. Please log in.'); // Redirect to login page after successful confirmation
  });
});

// POST for button
router.post('/query', async (req, res) => {
  const fromCurrency = req.body.fromCurrency;
  const toCurrency = req.body.toCurrency;

  const exchangeRate = await fetchExchangeRate(fromCurrency, toCurrency);

  res.json({ exchangeRate });
});

// POST for table
router.post('/getLastWeekData', async (req, res) => {
  const fromCurrency = req.body.selectedOption1;
  const toCurrency = req.body.selectedOption2;

  const exchangeRates = await fetchLastSevenDays(fromCurrency, toCurrency);

  res.json({ exchangeRates });
});

router.post('/getChart', async (req, res) => {
  const dataArray = req.body.dataArray;
  const labelsArray = req.body.labelsArray;
  const currencyPair = req.body.currencyPair;

  const myChart = new QuickChart();
  myChart
    .setConfig({
      type: 'line',
      data: {
        labels: labelsArray,
        datasets: [{ label: currencyPair, data: dataArray, borderColor: 'rgb(144, 238, 144)', backgroundColor: 'rgba(144, 238, 144, 0.5)'
        },],
      },
    })
    .setWidth(425)
    .setHeight(325)
    .setBackgroundColor('transparent');

  const chartUrl = myChart.getUrl();
  // console.log(chartUrl);

  res.send(chartUrl)


})


/*get profile page*/
router.get('/profile', requireAuth, function (req, res, next) {
  //retrieve currently logged in user's email
  const email = req.session.user.email

  //retrieve currencies from json file
  const filePath = path.join(__dirname, '..', 'public', 'currencies.json');
  const currencies = JSON.parse(fs.readFileSync(filePath, 'utf8')).currencies;

  //need to retrieve user's rate alerts from db
  const docClient = new AWS.DynamoDB.DocumentClient();

  const params = {
    TableName: "Users",
    KeyConditionExpression: '#u = :u',
    ExpressionAttributeNames: {
      '#u': 'user'
    },
    ExpressionAttributeValues: {
      ':u': email // Assuming email is the partition key value
    }
  };

  docClient.query(params, function (err, data) {
    if (err) {
      console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
      res.status(500).send("Error retrieving rate alerts");
    } else {
      const rateAlerts = data.Items || [];
      console.log(data.Items)
      res.render('profile', { email: email, rateAlerts: rateAlerts, currencies: currencies });
    }
  })
})

router.post('/profile', async (req, res, next) => {
  const { fromCurrency, toCurrency, rateExchange, alertId } = req.body;

  const email = req.session.user.email;

  const docClient = new AWS.DynamoDB.DocumentClient();

  const putParams = {
    TableName: 'Users',
    Item: {
      user: email,
      alertId: alertId,
      from: fromCurrency,
      to: toCurrency,
      rate: parseFloat(rateExchange)
    }
  };

  try {
    await docClient.put(putParams).promise();
    console.log('Rate alert saved successfully');
    res.redirect('/profile');
  } catch (err) {
    console.error('Error saving rate alert:', err);
    res.status(500).send('Error saving rate alert');
  }
});

router.post('/check-duplicate', async (req, res) => {
  const email = req.session.user.email;

  const { fromCurrency, toCurrency, rateExchange } = req.body;

  const docClient = new AWS.DynamoDB.DocumentClient();

  const paramsQuery = {
    TableName: 'Users',
    KeyConditionExpression: '#u = :u',
    ExpressionAttributeNames: {
      '#u': 'user'
    },
    ExpressionAttributeValues: {
      ':u': email
    }
  };

  try {
    const data = await docClient.query(paramsQuery).promise();
    const existingEntries = data.Items;

    // Check if the new entry already exists
    const isDuplicate = existingEntries.some(entry =>
      entry.from === fromCurrency &&
      entry.to === toCurrency &&
      entry.rate === parseFloat(rateExchange)
    );

    if (isDuplicate) {
      console.log('Duplicate entry found');
      res.status(400).send('Duplicate entry');
      return;
    }
    // No duplicate found, send success response
    res.sendStatus(200);
  } catch (err) {
    console.error('Error checking for duplicate entry:', err);
    res.status(500).send('Error checking for duplicate entry');
  }
});

router.delete('/profile/:alertId', async (req, res, next) => {
  const { alertId } = req.params;
  const email = req.session.user.email;

  const docClient = new AWS.DynamoDB.DocumentClient();

  const params = {
    TableName: 'Users',
    Key: {
      user: email,
      alertId: alertId
    }
  };

  try {
    await docClient.delete(params).promise();
    console.log(`Alert with id ${alertId} deleted successfully`);
    res.sendStatus(200); // Send a success response
  } catch (err) {
    console.error('Error deleting alert:', err);
    res.status(500).send('Error deleting alert');
  }
});

//via SES 
router.post('/sendEmail', async (req, res) => {
  const userCurrencyPair = 'USD/CAD';
  const targetRate = 1.25;
  const recipient = 'angelayu8800@gmail.com';
  const subject = 'Target rate hit!';
  const message = `The target rate of ${targetRate} for ${userCurrencyPair} has been hit!`;

  const params = {
    Destination: {
      ToAddresses: [recipient]
    },
    Message: {
      Body: {
        Text: { Data: message }
      },
      Subject: { Data: subject }
    },
    Source: 'ribbit.appnotifs@gmail.com' //THIS IS OUR WEB APP'S EMAIL (ask angela for the password)
  };

  try {
    const data = await ses.sendEmail(params).promise();
    console.log('Email sent:', data);
    res.send({ message: 'Email sent successfully' });
  } catch (err) {
    console.error('Email sending failed:', err);
    res.status(500).send({ message: 'Failed to send email' });
  }
});

//verify email with SES aka adding users to SES (once user signs up we can run this and get them to verify their email this is kinda awks cause it sends via AWS email ...)
router.post('/verify-email', async (req, res) => {
  const { email } = 'yuangelaa@icloud.com';

  const params = {
    EmailAddress: 'yuangelaa@icloud.com'
  };

  try {
    await ses.verifyEmailIdentity(params).promise();
    console.log(`Verification email sent to ${email}`);
    res.status(200).send('Verification email sent successfully');
  } catch (error) {
    console.error(`Failed to send verification email to ${email}:`, error);
    res.status(500).send('Failed to send verification email');
  }
});

router.get('/session-data', (req, res) => {
  console.log(req.session);
  res.send('Session data logged in the console.');
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/'); // Redirect to login page after logout
  });
});


/* get map  page */
router.get('/map', requireAuth, (req, res) => {

  res.render('map', {
    mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN
  });
});




module.exports = router;
