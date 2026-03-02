## Test Blocking:

| Command | Target | Result |
|---|---|---|
| `window.dispatchEvent(new Event('focus'));` | Focus suppression | ✅ Blocked |
| `window.dispatchEvent(new Event('blur'));` | Blur suppression | ✅ Blocked |
| `document.dispatchEvent(new Event('visibilitychange'));` | Visibility suppression | ✅ Blocked |
| `jQuery.ajax({ url: '/continue-to-learn', type: 'POST', data: JSON.stringify({ event: 'test_focus_loss' }), contentType: 'application/json' });` | AJAX interceptor | ✅ Blocked |
| `fetch('https://stats.sophia.org/track').then(r => console.log('Status:', r.status));` | Fetch blocker | ✅ Blocked |
| `var xhr = new XMLHttpRequest(); xhr.open('GET', 'https://analytics.sophia.org/collect'); xhr.send();` | XHR blocker | ✅ Blocked |
| `navigator.sendBeacon('https://dpm.demdex.net/id', 'test');` | Beacon blocker | ✅ Blocked |
| `localStorage.setItem('postponed_form_submit', 'test');` | Storage defense | ✅ Blocked |
| `localStorage.getItem('postponed_form_submit');` | Storage verification | ✅ Confirmed `null` |
| `dataLayer.push({ event: 'form_submit', data: 'test' });` | DataLayer trap | ✅ Blocked |
| `optimizely.push({ type: 'event', eventName: 'test' });` | Optimizely trap | ✅ Blocked |
| `document.cookie = 'sophia_st=test123; path=/';` | Cookie defense | ✅ Blocked |

- Intercept/Log all AJAX requests for '/continue-to-learn'
```javascript
$(document).ajaxSend(function(event, jqxhr, settings) {
    if (settings.url === '/continue-to-learn' && settings.type === 'POST') {
        console.log('AJAX Request:', settings);
        jqxhr.done(function(response) {
            console.log('AJAX Response:', response);
        }).fail(function(xhr, status, error) {
            console.log('AJAX Request Failed:', status, error);
        });
    }
});
```




---





### Third party resources Sophia uses:
- [Copyleaks](https://copyleaks.com/ai-content-detector)





---





## Global Helper Functions

<details>
<summary>Current User Information</summary>

```javascript
SOPHIA.currentUserId()           // User ID
SOPHIA.currentUserSlug()         // User slug (URL-friendly identifier)
SOPHIA.currentUserFirstName()    // First name
SOPHIA.currentUserLastName()     // Last name
SOPHIA.currentUserProgramId()    // Program ID
```
```javascript
SOPHIA.loggedIn()                // Check if logged in
```

</details>





---





## Automate Button Selection

<details>
<summary>Challenges</summary>

```javascript
$('#answer-0').click()   // Select answer A
$('#answer-1').click()   // Select answer B
$('#answer-2').click()   // Select answer C
$('#answer-3').click()   // Select answer D

document.querySelector('button.f-button.blue').click()   // Submit My Answer

document.querySelector('button[data-km-value*="go-to-the-next-concept"]').click()   // Go to the Next Concept
```

</details>

<details>
<summary>Milestones</summary>

```javascript
$('#answer_cb_0').click()   // Select answer A
$('#answer_cb_1').click()   // Select answer B
$('#answer_cb_2').click()   // Select answer C
$('#answer_cb_3').click()   // Select answer D

document.querySelector('.submit_block button.f-button.blue').click()   // Save & Continue

$('#submitMyMilestone').click()   // Submit Milestone
```

</details>

> **Note:** The submit/save buttons will only work after an answer has been selected.





---






## How Sophia Q&A Works

<details>
<summary>Overview</summary>

When you answer a question, here's what happens under the hood:

1. The current question state is stored in a **Vue.js** store at `#assessment-score-region`
2. When you click **Submit**, a `PUT` request is sent to `/challenge2_concept_takes/{take_id}`
3. The request body contains `question_index` (which question) and `answer` (which option you picked)
4. The server validates your answer and responds with the full question data, including which answer is `correct: true`
5. The Vue store updates and the UI re-renders to show correct/incorrect

</details>

<details>
<summary>Exploiting</summary>

We can send a dummy answer (`answer: 0`) to the server, and instead of rendering the result, we **intercept the response** to find which answer has `correct: true` — then auto-select it before actually submitting.

```javascript
let store = document.querySelector('#assessment-score-region').__vue_app__._context.provides.store.state;
let take = store.currentConceptTake;
let qIndex = store.currentQuizQuestionIndex;

$.ajax({
  url: '/challenge2_concept_takes/' + take.id,
  type: 'PUT',
  data: { question_index: qIndex, answer: 0 },
  success: function(response) {
    let correctIndex = response.questions[qIndex].answers.findIndex(a => a.correct);
    document.querySelector('#answer-' + correctIndex).click();
  }
});
```

</details>

<details>
<summary>How It Works Step by Step</summary>

| Step | What Happens |
|------|-------------|
| 1 | Grabs the Vue store state from `#assessment-score-region` |
| 2 | Gets the current `take.id` and `questionIndex` |
| 3 | Sends a `PUT` with `answer: 0` as a probe (burns one attempt) |
| 4 | Server responds with all answers, including `correct: true` on the right one |
| 5 | Finds the correct answer index from the response |
| 6 | Auto-clicks the correct answer in the UI |
| 7 | You click **Submit** to lock it in |

</details>

> **Note:** The probe request consumes one attempt. This is only useful for **Challenges** where you need to preserve attempts — Milestones don't track attempts.





---



## Milestone: Timer





<details>
<summary>⏱️ Timer Controls</summary>

- **Total time:**
```javascript
window._timer.totalTime
```

- **Remaining time:**
```javascript
Math.round((window._timer.endTime - Date.now()) / 60000);
```





- **Speed up timer**
```javascript
// Speed up timer — skips forward 1 minute every second (change 60000 to adjust speed)
window._speedTimer = setInterval(function() {
    window._timer.endTime -= 60000;
}, 1000);


clearInterval(window._speedTimer); // Stop it
```

- **Add Time** *(change `60` to desired minutes)*
```javascript
window._timer.endTime += 60 * 60 * 1000;
```

- **Subtract Time** *(change `10` to desired minutes)*
```javascript
window._timer.endTime -= 10 * 60 * 1000;
```

- **Pause Timer**
```javascript
window._pauseTimer = setInterval(function() {
    window._timer.endTime += 1000;
}, 1000);
```

- **Unpause Timer**
```javascript
clearInterval(window._pauseTimer);
```

- **Reset to Full Time**
```javascript
window._timer.endTime = new Date().getTime() + window._timer.totalTime * 60 * 1000;
```

- **Set Specific Minutes Remaining** *(change `45` to desired minutes)*
```javascript
window._timer.endTime = new Date().getTime() + 45 * 60 * 1000;
```

- **Check Time Remaining**
```javascript
var mins = Math.round((window._timer.endTime - new Date().getTime()) / 60000);
console.log(mins + ' minutes remaining');
```

- **Force Visual Refresh** *(run after any change for instant update)*
```javascript
window._timer.circles(window._timer.s, Math.round((window._timer.endTime - new Date().getTime()) / 60000));
jQuery('.flexible-assessment-header__submit-timer-minutes b').text(Math.round((window._timer.endTime - new Date().getTime()) / 60000));
```

</details>







