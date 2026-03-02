### Third party resources Sophia uses:
- [Copyleaks](https://copyleaks.com/ai-content-detector)

---

## SOPHIA Object - Full Reference

### Current User Information
```javascript
SOPHIA.currentUserId()           // User ID
SOPHIA.currentUserSlug()         // User slug (URL-friendly identifier)
SOPHIA.currentUserFirstName()    // First name
SOPHIA.currentUserLastName()     // Last name
SOPHIA.currentUserProgramId()    // Program ID
```
```
SOPHIA.loggedIn()                // Check if logged in
```

















---

## Automate Button Selection

#### Challenges
```javascript
$('#answer-0').click()   // Select answer A
$('#answer-1').click()   // Select answer B
$('#answer-2').click()   // Select answer C
$('#answer-3').click()   // Select answer D
```
```javascript
document.querySelector('button.f-button.blue').click()   // Submit My Answer
```

#### Milestones
```javascript
$('#answer_cb_0').click()   // Select answer A
$('#answer_cb_1').click()   // Select answer B
$('#answer_cb_2').click()   // Select answer C
$('#answer_cb_3').click()   // Select answer D
```
```javascript
document.querySelector('.submit_block button.f-button.blue').click()   // Save & Continue
```

> **Note:** The submit/save buttons will only work after an answer has been selected.

---

### How Sophia Q&A Works

When you answer a question, here's what happens under the hood:

1. The current question state is stored in a **Vue.js** store at `#assessment-score-region`
2. When you click **Submit**, a `PUT` request is sent to `/challenge2_concept_takes/{take_id}`
3. The request body contains `question_index` (which question) and `answer` (which option you picked)
4. The server validates your answer and responds with the full question data, including which answer is `correct: true`
5. The Vue store updates and the UI re-renders to show correct/incorrect

#### Exploiting This

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

#### How It Works Step by Step

| Step | What Happens |
|------|-------------|
| 1 | Grabs the Vue store state from `#assessment-score-region` |
| 2 | Gets the current `take.id` and `questionIndex` |
| 3 | Sends a `PUT` with `answer: 0` as a probe (burns one attempt) |
| 4 | Server responds with all answers, including `correct: true` on the right one |
| 5 | Finds the correct answer index from the response |
| 6 | Auto-clicks the correct answer in the UI |
| 7 | You click **Submit** to lock it in |

---

