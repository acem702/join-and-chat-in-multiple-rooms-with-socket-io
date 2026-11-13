# join-and-chat
A real-time multi-user chat room where you can create and join rooms, built on node.js + Socket.IO + Express.<br>

![version](https://img.shields.io/badge/version-2.0.0-green.svg)

![join-and-chat](https://cloud.githubusercontent.com/assets/24193072/26714744/837dccfc-47a5-11e7-86e0-953f63dd9c77.png)<br><br>

## Introduction
In <strong> join-and-chat </strong>, you sign in with a nickname and are placed in the "Lobby" by default, where you can talk to everyone else in the same room. The application works as follows:<br>

<ol>

<li>Type the command <b>/join [room name]</b> to create a room, or to join it if it already exists.</li>

<li>As well as the /join command, you can click any room in the list on the right to join it directly. The highlighted room is the one you are currently in, and the number beside each room is how many people are in it. A filter box narrows a long list, and Enter joins the first match.</li>

<li>The command <b>/ls</b> refreshes the room list. It also refreshes automatically every 30 seconds, and immediately for everyone whenever someone joins or leaves the chat lab or a room.</li>

<li>The room list can be collapsed to a narrow rail with the « button at the top of the panel, giving the conversation the full width. On a narrow screen it becomes a drawer instead.</li>

</ol>
<br>

## Demo
The original Heroku demo site has been retired. Follow the instructions below to run it locally.<br>
<br>

## How to use the code
 You need node.js installed (version 18 or newer).<br>
 Open a command prompt, change into the project directory and run:<br><br>
```npm install```<br><br>
This installs the dependencies declared in package.json. Once it finishes, run:<br><br>
```npm start```<br><br>
That starts a local server. Open a browser at <b>localhost:3232</b> (the port can be changed with the PORT environment variable) and that's it!<br><br>
To run the tests:<br><br>
```npm test```<br><br>

## License
MIT license.<br><br>

## Information
Author: &nbsp;GW19 &nbsp;<br>
If you think any part of the code could be improved, please do tell me — I would be very grateful!<br><br>
